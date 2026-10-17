import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import * as api from '@/lib/api';
import {
  ensureDataCacheLoaded,
  isDataCacheLoaded,
  getCachedOrganizations,
  setCachedOrganizations,
  getCachedSpaces,
  setCachedSpaces,
  getCachedCollections,
  setCachedCollections,
  getCachedBookmarksBySpace,
  setCachedBookmarksBySpace,
  setCachedBookmarksForCollection,
} from '@/lib/dataCache';
import { subscribeBookmarksChanged } from '@/lib/bookmarksSync';
import { isAbortError } from '@/lib/serverReachability';

async function whenCacheReady() {
  if (!isDataCacheLoaded()) await ensureDataCacheLoaded();
}

export function useOrganizations(enabled = true) {
  const [orgs, setOrgs] = useState<api.Organization[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!enabled) return;

    await whenCacheReady();
    const cached = getCachedOrganizations();
    if (cached) {
      setOrgs(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const data = await api.getOrganizations();
      setCachedOrganizations(data);
      setOrgs(data);
    } catch {
      // keep cache
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { void fetch(); }, [fetch]);

  return { orgs, loading, refetch: fetch };
}

export function useSpaces(orgId?: string | null, enabled = true) {
  const [spaces, setSpaces] = useState<api.Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = orgId || '__personal__';

  const fetch = useCallback(async () => {
    if (!enabled) return;

    await whenCacheReady();
    const cached = getCachedSpaces(cacheKey);
    if (cached) {
      setSpaces(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    setError(null);
    try {
      const data = await api.getSpaces(orgId);
      setCachedSpaces(cacheKey, data);
      setSpaces(data);
    } catch (e: any) {
      setError(e.message);
      if (!cached) setSpaces([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, enabled, cacheKey]);

  useEffect(() => { fetch(); }, [fetch]);

  return { spaces, loading, error, refetch: fetch };
}

export function useCollections(spaceId: string | null, enabled = true) {
  const [collections, setCollections] = useState<api.Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(async () => {
    abortRef.current?.abort();

    if (!enabled || !spaceId) {
      abortRef.current = null;
      setCollections([]);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;

    await whenCacheReady();
    if (ac.signal.aborted) return;

    const cached = getCachedCollections(spaceId);
    if (cached) {
      setCollections(cached);
      setLoading(false);
    } else {
      setCollections([]);
      setLoading(true);
    }

    setError(null);
    try {
      const data = await api.getCollections(spaceId, ac.signal);
      if (ac.signal.aborted) return;
      setCachedCollections(spaceId, data);
      setCollections(data);
    } catch (e: unknown) {
      if (isAbortError(e) || ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      if (!cached) setCollections([]);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [spaceId, enabled]);

  useLayoutEffect(() => {
    if (!enabled || !spaceId || !isDataCacheLoaded()) return;
    const cached = getCachedCollections(spaceId);
    if (cached) {
      setCollections(cached);
      setLoading(false);
    }
  }, [spaceId, enabled]);

  useEffect(() => {
    void fetch();
    return () => abortRef.current?.abort();
  }, [fetch]);

  return { collections, loading, error, refetch: fetch };
}

export function useBookmarks(collectionId: string | null) {
  const [bookmarks, setBookmarks] = useState<api.Bookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!collectionId) { setBookmarks([]); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getBookmarks(collectionId);
      setBookmarks(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => { fetch(); }, [fetch]);

  const add = useCallback(async (params: Parameters<typeof api.createBookmark>[0]) => {
    const bookmark = await api.createBookmark(params);
    setBookmarks((prev) => [...prev, bookmark]);
    return bookmark;
  }, []);

  const update = useCallback(async (id: string, updates: Parameters<typeof api.updateBookmark>[1]) => {
    const bookmark = await api.updateBookmark(id, updates);
    setBookmarks((prev) => prev.map((b) => (b.id === id ? bookmark : b)));
    return bookmark;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteBookmark(id);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return { bookmarks, loading, error, refetch: fetch, add, update, remove };
}

export function useCollectionBookmarks(spaceId: string | null) {
  const [data, setData] = useState<Record<string, api.Bookmark[]>>({});
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mutateEpochRef = useRef(0);

  /** Drop in-flight GET results so they cannot overwrite local mutations. */
  const bumpFetchGen = useCallback(() => {
    mutateEpochRef.current += 1;
  }, []);

  const fetch = useCallback(async (_force = false) => {
    abortRef.current?.abort();

    if (!spaceId) {
      abortRef.current = null;
      setData({});
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    const epoch = mutateEpochRef.current;

    await whenCacheReady();
    if (ac.signal.aborted) return;

    const cached = getCachedBookmarksBySpace(spaceId);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setData({});
      setLoading(true);
    }

    try {
      const byCollection = await api.getBookmarksBySpace(spaceId, ac.signal);
      if (ac.signal.aborted) return;
      if (mutateEpochRef.current === epoch) {
        setCachedBookmarksBySpace(spaceId, byCollection);
        setData(byCollection);
      }
    } catch (e: unknown) {
      if (isAbortError(e) || ac.signal.aborted) return;
      // keep previous / cached data on failure
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [spaceId]);

  useLayoutEffect(() => {
    if (!spaceId || !isDataCacheLoaded()) return;
    const cached = getCachedBookmarksBySpace(spaceId);
    if (cached) {
      setData(cached);
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void fetch();
    return () => abortRef.current?.abort();
  }, [fetch]);

  // Popup (and other pages) signal via chrome.storage — refetch when relevant.
  // Hidden newtabs defer the fetch until they become visible again.
  useEffect(() => {
    let pending = false;

    const refreshIfNeeded = () => {
      if (!spaceId) return;
      pending = false;
      void fetch(true);
    };

    const unsub = subscribeBookmarksChanged((event) => {
      if (!spaceId) return;
      if (event.spaceId && event.spaceId !== spaceId) return;
      if (typeof document !== 'undefined' && document.hidden) {
        pending = true;
        return;
      }
      refreshIfNeeded();
    });

    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden && pending) {
        refreshIfNeeded();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [spaceId, fetch]);

  const reorder = useCallback(async (collectionId: string, orderedBookmarks: api.Bookmark[]) => {
    if (!spaceId) return;
    bumpFetchGen();
    const bookmarkIds = orderedBookmarks.map((b) => b.id);
    await api.reorderBookmarks(collectionId, bookmarkIds);
    setData((prev) => ({ ...prev, [collectionId]: orderedBookmarks }));
    await setCachedBookmarksForCollection(spaceId, collectionId, orderedBookmarks, { flush: true });
  }, [spaceId, bumpFetchGen]);

  /** Optimistic local reorder without REST (CRDT path). */
  const reorderLocal = useCallback((collectionId: string, orderedBookmarks: api.Bookmark[]) => {
    if (!spaceId) return;
    bumpFetchGen();
    setData((prev) => ({ ...prev, [collectionId]: orderedBookmarks }));
    void setCachedBookmarksForCollection(spaceId, collectionId, orderedBookmarks, { flush: true });
  }, [spaceId, bumpFetchGen]);

  const update = useCallback(async (id: string, updates: Parameters<typeof api.updateBookmark>[1]) => {
    const bookmark = await api.updateBookmark(id, updates);
    if (!spaceId) return bookmark;
    bumpFetchGen();
    let next: Record<string, api.Bookmark[]> = {};
    setData((prev) => {
      next = { ...prev };
      for (const colId of Object.keys(next)) {
        next[colId] = next[colId].filter((b) => b.id !== id);
      }
      const targetColId = bookmark.collectionId;
      if (!next[targetColId]) next[targetColId] = [];
      next[targetColId] = [...next[targetColId], bookmark].sort((a, b) => a.orderIndex - b.orderIndex);
      return next;
    });
    await setCachedBookmarksBySpace(spaceId, next, { flush: true });
    return bookmark;
  }, [spaceId, bumpFetchGen]);

  const remove = useCallback(async (id: string) => {
    await api.deleteBookmark(id);
    if (!spaceId) return;
    bumpFetchGen();
    let next: Record<string, api.Bookmark[]> = {};
    setData((prev) => {
      next = { ...prev };
      for (const colId of Object.keys(next)) {
        next[colId] = next[colId].filter((b) => b.id !== id);
      }
      return next;
    });
    await setCachedBookmarksBySpace(spaceId, next, { flush: true });
  }, [spaceId, bumpFetchGen]);

  const add = useCallback(async (params: Parameters<typeof api.createBookmark>[0]) => {
    const bookmark = await api.createBookmark(params);
    if (!spaceId) return bookmark;
    bumpFetchGen();
    let next: Record<string, api.Bookmark[]> = {};
    setData((prev) => {
      const list = [...(prev[params.collectionId] || []), bookmark];
      next = { ...prev, [params.collectionId]: list };
      return next;
    });
    await setCachedBookmarksBySpace(spaceId, next, { flush: true });
    return bookmark;
  }, [spaceId, bumpFetchGen]);

  const refetch = useCallback(() => fetch(true), [fetch]);

  return { data, loading, refetch, reorder, reorderLocal, update, remove, add };
}
