import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDataCache,
  getCachedBookmarksBySpace,
  setCachedBookmarksBySpace,
} from '@/lib/dataCache';

const CACHE_KEY = 'data_cache_v2';
const MAX_BOOKMARK_SPACES = 30;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

type Store = Record<string, unknown>;

function installChromeMock(store: Store) {
  const local = {
    get: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (k in store) out[k] = store[k];
      }
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    },
    remove: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
    },
  };
  vi.stubGlobal('chrome', { storage: { local } });
}

describe('dataCache prune', () => {
  let store: Store;

  beforeEach(async () => {
    store = {};
    installChromeMock(store);
    await clearDataCache();
  });

  afterEach(async () => {
    await clearDataCache();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps entries older than 7 days when another save runs', async () => {
    vi.useFakeTimers();
    const oldData = { col1: [] };

    vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
    await setCachedBookmarksBySpace('old-space', oldData, { flush: true });

    vi.setSystemTime(Date.now() + EIGHT_DAYS_MS);
    await setCachedBookmarksBySpace('new-space', { col2: [] }, { flush: true });

    expect(getCachedBookmarksBySpace('old-space')).toEqual(oldData);

    const persisted = store[CACHE_KEY] as {
      bookmarksBySpace: Record<string, { data: unknown }>;
    };
    expect(persisted.bookmarksBySpace['old-space']?.data).toEqual(oldData);
  });

  it('evicts the least-recently-updated space once over capacity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    for (let i = 0; i < MAX_BOOKMARK_SPACES + 1; i++) {
      vi.setSystemTime(i * 1000);
      await setCachedBookmarksBySpace(`space-${i}`, { col: [] }, { flush: true });
    }

    expect(getCachedBookmarksBySpace('space-0')).toBeNull();
    expect(getCachedBookmarksBySpace('space-1')).not.toBeNull();
    expect(getCachedBookmarksBySpace(`space-${MAX_BOOKMARK_SPACES}`)).not.toBeNull();
  });
});
