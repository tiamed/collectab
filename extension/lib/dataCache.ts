import { browser } from 'wxt/browser';
import type { Space, Collection, Bookmark, User, Organization, SearchResult } from './api';
import { bookmarkMatches } from './search';

const CACHE_KEY = 'data_cache_v2';
const MAX_SPACES = 12;
const MAX_COLLECTION_SETS = 30;
const MAX_BOOKMARK_SPACES = 30;

interface CacheEntry<T> {
  data: T;
  updatedAt: number;
}

/** Bookmarks for one space, keyed by collectionId. */
export type SpaceBookmarks = Record<string, Bookmark[]>;

interface DataCache {
  user: CacheEntry<User> | null;
  organizations: CacheEntry<Organization[]> | null;
  spaces: Record<string, CacheEntry<Space[]>>;
  collections: Record<string, CacheEntry<Collection[]>>;
  /** Keyed by spaceId — matches GET /bookmarks?spaceId= */
  bookmarksBySpace: Record<string, CacheEntry<SpaceBookmarks>>;
}

const emptyCache = (): DataCache => ({
  user: null,
  organizations: null,
  spaces: {},
  collections: {},
  bookmarksBySpace: {},
});

let memory: DataCache = emptyCache();
let loaded = false;
let loadPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function getStorageLocal() {
  const browserStorage = (browser as unknown as { storage?: { local?: typeof browser.storage.local } })
    ?.storage?.local;
  if (browserStorage) return browserStorage;
  const chromeStorage = (globalThis as unknown as { chrome?: { storage?: { local?: typeof browser.storage.local } } })
    .chrome?.storage?.local;
  return chromeStorage;
}

function getEntry<T>(record: Record<string, CacheEntry<T>>, key: string): T | null {
  const entry = record[key];
  if (!entry) return null;
  return entry.data;
}

function pruneRecord<T>(record: Record<string, CacheEntry<T>>, max: number) {
  const entries = Object.entries(record).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  if (entries.length <= max) return;
  for (const [key] of entries.slice(max)) {
    delete record[key];
  }
}

function scheduleSave(immediate = false): Promise<void> {
  const storageLocal = getStorageLocal();
  if (!storageLocal) return Promise.resolve();
  if (saveTimer) clearTimeout(saveTimer);

  const write = () => {
    saveTimer = null;
    pruneRecord(memory.spaces, MAX_SPACES);
    pruneRecord(memory.collections, MAX_COLLECTION_SETS);
    pruneRecord(memory.bookmarksBySpace, MAX_BOOKMARK_SPACES);
    return storageLocal.set({ [CACHE_KEY]: memory }).catch(() => {});
  };

  if (immediate) {
    return Promise.resolve(write()).then(() => undefined);
  }
  return new Promise((resolve) => {
    saveTimer = setTimeout(() => {
      void write().then(() => resolve());
    }, 200);
  });
}

export function hasCachedData(): boolean {
  return (
    !!memory.user ||
    !!memory.organizations ||
    Object.keys(memory.spaces).length > 0 ||
    Object.keys(memory.collections).length > 0 ||
    Object.keys(memory.bookmarksBySpace).length > 0
  );
}

/** Wipe in-memory + persisted cache (e.g. after switching API server). */
export async function clearDataCache(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  memory = emptyCache();
  loaded = true;
  loadPromise = null;
  const storageLocal = getStorageLocal();
  if (storageLocal) {
    await storageLocal.remove([CACHE_KEY, 'data_cache_v1']).catch(() => {});
  }
}

export async function ensureDataCacheLoaded() {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const storageLocal = getStorageLocal();
      if (storageLocal) {
        const stored = await storageLocal.get([CACHE_KEY, 'data_cache_v1']);
        if (stored[CACHE_KEY]) {
          memory = { ...emptyCache(), ...stored[CACHE_KEY] };
          if (!memory.bookmarksBySpace) memory.bookmarksBySpace = {};
          // Drop legacy per-collection bookmark map if present
          delete (memory as DataCache & { bookmarks?: unknown }).bookmarks;
        } else if (stored['data_cache_v1']) {
          const v1 = stored['data_cache_v1'] as {
            spaces?: DataCache['spaces'];
            collections?: DataCache['collections'];
          };
          memory = {
            ...emptyCache(),
            spaces: v1.spaces || {},
            collections: v1.collections || {},
            bookmarksBySpace: {},
          };
          scheduleSave();
          storageLocal.remove('data_cache_v1').catch(() => {});
        }
      }
    } catch {
      // ignore
    } finally {
      loaded = true;
    }
  })();
  return loadPromise;
}

export function isDataCacheLoaded(): boolean {
  return loaded;
}

export function getCachedUser(): User | null {
  return memory.user?.data ?? null;
}

export function setCachedUser(user: User | null) {
  memory.user = user ? { data: user, updatedAt: Date.now() } : null;
  scheduleSave(true);
}

export function getCachedOrganizations(): Organization[] | null {
  return memory.organizations?.data ?? null;
}

export function setCachedOrganizations(data: Organization[]) {
  memory.organizations = { data, updatedAt: Date.now() };
  scheduleSave();
}

export function getCachedSpaces(orgKey: string): Space[] | null {
  return getEntry(memory.spaces, orgKey);
}

export function setCachedSpaces(orgKey: string, data: Space[]) {
  memory.spaces[orgKey] = { data, updatedAt: Date.now() };
  scheduleSave();
}

export function getCachedCollections(spaceId: string): Collection[] | null {
  return getEntry(memory.collections, spaceId);
}

export function setCachedCollections(spaceId: string, data: Collection[]) {
  memory.collections[spaceId] = { data, updatedAt: Date.now() };
  scheduleSave();
}

export function getCachedBookmarksBySpace(spaceId: string): SpaceBookmarks | null {
  return getEntry(memory.bookmarksBySpace, spaceId);
}

export function setCachedBookmarksBySpace(
  spaceId: string,
  data: SpaceBookmarks,
  opts?: { flush?: boolean },
): Promise<void> {
  memory.bookmarksBySpace[spaceId] = { data, updatedAt: Date.now() };
  return scheduleSave(opts?.flush === true);
}

/**
 * Offline / instant search over every cached space. Spaces or collections
 * missing from the cache are skipped since they can't be labelled.
 */
export function searchCachedBookmarks(terms: string[]): SearchResult[] {
  if (terms.length === 0) return [];
  const spacesById = new Map<string, Space>();
  for (const entry of Object.values(memory.spaces)) {
    for (const s of entry.data) spacesById.set(s.id, s);
  }
  const orgsById = new Map((memory.organizations?.data ?? []).map((o) => [o.id, o]));

  const results: SearchResult[] = [];
  for (const [spaceId, entry] of Object.entries(memory.bookmarksBySpace)) {
    const space = spacesById.get(spaceId);
    if (!space) continue;
    const cols = new Map((memory.collections[spaceId]?.data ?? []).map((c) => [c.id, c]));
    const org = space.orgId ? orgsById.get(space.orgId) : undefined;
    for (const [colId, bks] of Object.entries(entry.data)) {
      const col = cols.get(colId);
      if (!col) continue;
      for (const b of bks) {
        if (!bookmarkMatches(b, terms)) continue;
        results.push({
          bookmark: b,
          collection: { id: col.id, name: col.name, icon: col.icon, orderIndex: col.orderIndex },
          space: {
            id: space.id,
            name: space.name,
            icon: space.icon,
            orgId: space.orgId ?? null,
            orderIndex: space.orderIndex,
          },
          org: space.orgId ? { id: space.orgId, name: org?.name ?? '', icon: org?.icon ?? null } : null,
        });
      }
    }
  }
  return results;
}

/** Patch one collection inside a space cache entry. */
export function setCachedBookmarksForCollection(
  spaceId: string,
  collectionId: string,
  bookmarks: Bookmark[],
  opts?: { flush?: boolean },
): Promise<void> {
  const existing = getCachedBookmarksBySpace(spaceId) || {};
  return setCachedBookmarksBySpace(spaceId, { ...existing, [collectionId]: bookmarks }, opts);
}
