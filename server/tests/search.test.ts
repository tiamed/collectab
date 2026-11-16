import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createTestApp, generateTestToken } from './helpers.js';

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock('../src/database/client.js', () => ({
  getDb: () => ({ execute: executeMock }),
}));

describe('GET /api/search', () => {
  const app = createTestApp();
  const authHeader = { Authorization: `Bearer ${generateTestToken('user-1')}` };

  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
  });

  it('returns nothing for an empty query without hitting the DB', async () => {
    const res = await app.request('/api/search?q=%20%20', { headers: authHeader });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [], query: '' });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('matches every term with escaped ILIKE patterns and scopes to readable spaces', async () => {
    await app.request(`/api/search?q=${encodeURIComponent('文档 50%')}`, { headers: authHeader });
    const query = new PgDialect().sqlToQuery(executeMock.mock.calls[0][0]);
    expect(query.sql).toContain('space_members');
    expect(query.sql).toContain('o.owner_id');
    expect(query.params).toContain('%文档%');
    expect(query.params).toContain('%50\\%%');
    expect(query.params.filter((p) => p === 'user-1')).toHaveLength(3);
  });

  it('returns bookmarks with their collection, space and org', async () => {
    executeMock.mockResolvedValue({
      rows: [{
        id: 'b1', collection_id: 'c1', title: 'React', url: 'https://react.dev',
        description: null, favicon: null, tags: null, order_index: 2,
        created_at: '2026-01-01', updated_at: '2026-01-01',
        collection_name: 'Docs', collection_icon: '📁', collection_order: 1,
        space_id: 's1', space_name: 'Work', space_icon: '💼', space_order: 0,
        org_id: 'o1', org_name: 'Acme', org_icon: '🏢',
      }],
    });
    const res = await app.request('/api/search?q=react', { headers: authHeader });
    const body = await res.json();
    expect(body.results).toEqual([{
      bookmark: {
        id: 'b1', collectionId: 'c1', title: 'React', url: 'https://react.dev',
        description: null, favicon: null, tags: [], orderIndex: 2,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
      collection: { id: 'c1', name: 'Docs', icon: '📁', orderIndex: 1 },
      space: { id: 's1', name: 'Work', icon: '💼', orgId: 'o1', orderIndex: 0 },
      org: { id: 'o1', name: 'Acme', icon: '🏢' },
    }]);
  });
});
