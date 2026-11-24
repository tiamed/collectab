import { describe, it, expect, vi } from 'vitest';
import { createTestApp, generateTestToken } from './helpers.js';

const { recordedBookmarkUpdates } = vi.hoisted(() => ({
  recordedBookmarkUpdates: [] as Record<string, unknown>[],
}));

vi.mock('../src/database/client.js', () => {
  const mockBookmarks: any[] = [];
  const mockCollection = {
    id: 'col-abc',
    spaceId: 'space-1',
    ownerId: 'user-123',
    name: 'Test Col',
    icon: '📁',
    color: '#9761da',
    orderIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockSpace = {
    id: 'space-1',
    ownerId: 'user-123',
    orgId: null,
    name: 'Test Space',
    icon: '💼',
    orderIndex: 0,
    createdAt: new Date(),
  };

  function makeChain(rows: any[]) {
    const chain: any = {
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(rows),
      then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }

  const mockDb = {
    select: (cols?: any) => ({
      from: () => {
        // select({ id }) for collections in space
        if (cols && typeof cols === 'object' && 'id' in cols && !('title' in cols) && !('collectionId' in cols) && Object.keys(cols).length <= 2) {
          return makeChain([{ id: mockCollection.id }]);
        }
        // select bookmark fields for space batch
        if (cols && typeof cols === 'object' && 'collectionId' in cols && 'title' in cols) {
          return makeChain(mockBookmarks);
        }
        // default: access checks + single-collection lists
        return makeChain([mockCollection, mockSpace]);
      },
    }),
    insert: () => ({
      values: (data: any) => ({
        returning: () => {
          if (Array.isArray(data)) {
            const results = data.map((d: any, i: number) => ({
              id: `bm-${i}`,
              ...d,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));
            mockBookmarks.push(...results);
            return Promise.resolve(results);
          }
          const newBm = {
            id: 'bm-' + Math.random().toString(36).slice(2, 8),
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockBookmarks.push(newBm);
          return Promise.resolve([newBm]);
        },
      }),
    }),
    update: () => ({
      set: (data: any) => {
        recordedBookmarkUpdates.push(data);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ ...(mockBookmarks[0] ?? {}), ...data }]),
          }),
        };
      },
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    execute: () => Promise.resolve({ rows: [] }),
  };

  return { getDb: () => mockDb };
});

describe('Bookmarks routes', () => {
  const app = createTestApp();
  const token = generateTestToken('user-123');
  const authHeader = { Authorization: `Bearer ${token}` };

  describe('GET /api/bookmarks', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.request('/api/bookmarks?collectionId=550e8400-e29b-41d4-a716-446655440000');
      expect(res.status).toBe(401);
    });

    it('requires exactly one of collectionId or spaceId', async () => {
      const res = await app.request('/api/bookmarks', { headers: authHeader });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('collectionId or spaceId');
    });

    it('rejects both collectionId and spaceId', async () => {
      const res = await app.request(
        '/api/bookmarks?collectionId=550e8400-e29b-41d4-a716-446655440000&spaceId=550e8400-e29b-41d4-a716-446655440001',
        { headers: authHeader },
      );
      expect(res.status).toBe(400);
    });

    it('returns bookmarks for valid collection', async () => {
      const res = await app.request('/api/bookmarks?collectionId=550e8400-e29b-41d4-a716-446655440000', {
        headers: authHeader,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('bookmarks');
    });

    it('returns bookmarksByCollection for valid spaceId', async () => {
      const res = await app.request('/api/bookmarks?spaceId=550e8400-e29b-41d4-a716-446655440001', {
        headers: authHeader,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('bookmarksByCollection');
      expect(body.bookmarksByCollection).toHaveProperty('col-abc');
      expect(Array.isArray(body.bookmarksByCollection['col-abc'])).toBe(true);
    });
  });

  describe('POST /api/bookmarks', () => {
    it('rejects invalid URL', async () => {
      const res = await app.request('/api/bookmarks', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Test',
          url: 'not-a-url',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing title', async () => {
      const res = await app.request('/api/bookmarks', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: '550e8400-e29b-41d4-a716-446655440000',
          url: 'https://example.com',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('stores a non-empty description', async () => {
      const res = await app.request('/api/bookmarks', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Example',
          url: 'https://example.com',
          description: 'Saved from the popup',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.bookmark.description).toBe('Saved from the popup');
    });

    it('creates bookmark with valid data', async () => {
      const res = await app.request('/api/bookmarks', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Example',
          url: 'https://example.com',
          tags: ['test'],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.bookmark.title).toBe('Example');
      expect(body.bookmark.url).toBe('https://example.com');
    });
  });

  describe('POST /api/bookmarks/batch', () => {
    it('creates multiple bookmarks', async () => {
      const res = await app.request('/api/bookmarks/batch', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: '550e8400-e29b-41d4-a716-446655440000',
          bookmarks: [
            { title: 'GitHub', url: 'https://github.com' },
            { title: 'Google', url: 'https://google.com' },
          ],
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.bookmarks).toHaveLength(2);
    });

    it('rejects invalid bookmark in batch', async () => {
      const res = await app.request('/api/bookmarks/batch', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: '550e8400-e29b-41d4-a716-446655440000',
          bookmarks: [{ title: 'Bad', url: 'not-valid' }],
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/bookmarks/:id description', () => {
    const headers = { ...authHeader, 'Content-Type': 'application/json' };
    const id = '550e8400-e29b-41d4-a716-446655440099';

    it('clears a description when the update sends an empty string or null', async () => {
      recordedBookmarkUpdates.length = 0;

      const empty = await app.request(`/api/bookmarks/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ description: '' }),
      });
      expect(empty.status).toBe(200);
      expect((await empty.json()).bookmark.description).toBeNull();

      const blank = await app.request(`/api/bookmarks/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ description: '   ' }),
      });
      expect(blank.status).toBe(200);
      expect((await blank.json()).bookmark.description).toBeNull();

      const cleared = await app.request(`/api/bookmarks/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ description: null }),
      });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).bookmark.description).toBeNull();

      expect(recordedBookmarkUpdates.map((update) => update.description)).toEqual([null, null, null]);
    });

    it('keeps a non-empty description and leaves description unchanged when omitted', async () => {
      recordedBookmarkUpdates.length = 0;

      const kept = await app.request(`/api/bookmarks/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ description: '  Still here  ' }),
      });
      expect(kept.status).toBe(200);
      expect((await kept.json()).bookmark.description).toBe('Still here');

      const omitted = await app.request(`/api/bookmarks/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ title: 'Only title' }),
      });
      expect(omitted.status).toBe(200);
      expect(recordedBookmarkUpdates[1]).not.toHaveProperty('description');
      expect(recordedBookmarkUpdates[1].title).toBe('Only title');
    });
  });
});
