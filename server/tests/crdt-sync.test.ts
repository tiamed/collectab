import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { SyncBatcher } from '../src/server/sync-batcher.js';

const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';
const ID_OUTSIDE = '33333333-3333-3333-3333-333333333333';
const COL_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeDoc(ids: string[]) {
  const doc = new LoroDoc();
  const list = doc.getList(COL_1);
  for (const id of ids) list.push(id);
  doc.commit();
  return doc;
}

function makePool(opts: {
  currentRows?: { id: string; collection_id: string; order_index: number }[];
  colIds?: string[];
}) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const currentRows = opts.currentRows ?? [];
  const colIds = opts.colIds ?? [COL_1];

  const mockClient = {
    query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM collections WHERE space_id')) {
        return { rows: colIds.map((id) => ({ id })) };
      }
      if (sql.includes('FROM bookmarks b')) {
        return { rows: currentRows };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  const mockPool = {
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue(mockClient),
  };

  return { mockPool, mockClient, queries };
}

describe('SyncBatcher', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a single VALUES UPDATE without order_index = -1 when rows differ', async () => {
    const doc = makeDoc([ID_A, ID_B]);
    const mockMgr = { getDocIfLoaded: vi.fn().mockReturnValue(doc) };
    const { mockPool, mockClient, queries } = makePool({
      currentRows: [
        { id: ID_A, collection_id: COL_1, order_index: 1 },
        { id: ID_B, collection_id: COL_1, order_index: 0 },
      ],
    });

    const batcher = new SyncBatcher(mockMgr as any, 0, () => mockPool as any, 0);
    await batcher.flushNow('space-1');

    const sqls = queries.map((q) => q.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((s) => s.includes('SET order_index = -1'))).toBe(false);
    const update = queries.find((q) => q.sql.includes('FROM (VALUES'));
    expect(update).toBeTruthy();
    expect(update!.sql).toContain('SET collection_id = v.collection_id, order_index = v.order_index');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('does not touch bookmarks that are outside the Loro doc', async () => {
    const doc = makeDoc([ID_A]);
    const mockMgr = { getDocIfLoaded: vi.fn().mockReturnValue(doc) };
    const { mockPool, queries } = makePool({
      currentRows: [
        { id: ID_A, collection_id: COL_1, order_index: 5 },
        { id: ID_OUTSIDE, collection_id: COL_1, order_index: 99 },
      ],
    });

    const batcher = new SyncBatcher(mockMgr as any, 0, () => mockPool as any, 0);
    await batcher.flushNow('space-1');

    const update = queries.find((q) => q.sql.includes('FROM (VALUES'));
    expect(update).toBeTruthy();
    expect(update!.params).toContain(ID_A);
    expect(update!.params).not.toContain(ID_OUTSIDE);
    for (const q of queries) {
      if (q.params) expect(q.params).not.toContain(ID_OUTSIDE);
    }
  });

  it('skips UPDATE when SQL already matches the doc', async () => {
    const doc = makeDoc([ID_A, ID_B]);
    const mockMgr = { getDocIfLoaded: vi.fn().mockReturnValue(doc) };
    const { mockPool, queries } = makePool({
      currentRows: [
        { id: ID_A, collection_id: COL_1, order_index: 0 },
        { id: ID_B, collection_id: COL_1, order_index: 1 },
      ],
    });

    const batcher = new SyncBatcher(mockMgr as any, 0, () => mockPool as any, 0);
    await batcher.flushNow('space-1');

    expect(queries.some((q) => q.sql.includes('FROM (VALUES'))).toBe(false);
    expect(queries.map((q) => q.sql)).toContain('COMMIT');
  });

  it('trailing quiet window flushes after debounceMs', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([ID_A]);
    const mockMgr = { getDocIfLoaded: vi.fn().mockReturnValue(doc) };
    const { mockPool, queries } = makePool({
      currentRows: [{ id: ID_A, collection_id: COL_1, order_index: 5 }],
    });

    const batcher = new SyncBatcher(mockMgr as any, 500, () => mockPool as any, 10_000);
    batcher.notifyChange('space-1');
    expect(queries.some((q) => q.sql.includes('FROM (VALUES'))).toBe(false);

    await vi.advanceTimersByTimeAsync(499);
    expect(queries.some((q) => q.sql.includes('FROM (VALUES'))).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(queries.some((q) => q.sql.includes('FROM (VALUES'))).toBe(true);
  });

  it('maxWait flushes while trailing keeps bouncing', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([ID_A]);
    const mockMgr = { getDocIfLoaded: vi.fn().mockReturnValue(doc) };
    const { mockPool, queries } = makePool({
      currentRows: [{ id: ID_A, collection_id: COL_1, order_index: 5 }],
    });

    const batcher = new SyncBatcher(mockMgr as any, 500, () => mockPool as any, 2000);
    batcher.notifyChange('space-1');

    for (let t = 0; t < 1900; t += 100) {
      await vi.advanceTimersByTimeAsync(100);
      batcher.notifyChange('space-1');
    }
    expect(queries.some((q) => q.sql.includes('FROM (VALUES'))).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(queries.some((q) => q.sql.includes('FROM (VALUES'))).toBe(true);
  });

  it('re-arms trailing and maxWait after a flush', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([ID_A]);
    const mockMgr = { getDocIfLoaded: vi.fn().mockReturnValue(doc) };
    const { mockPool, queries } = makePool({
      currentRows: [{ id: ID_A, collection_id: COL_1, order_index: 5 }],
    });

    const batcher = new SyncBatcher(mockMgr as any, 500, () => mockPool as any, 2000);
    batcher.notifyChange('space-1');
    await vi.advanceTimersByTimeAsync(500);
    const afterFirst = queries.filter((q) => q.sql.includes('FROM (VALUES')).length;
    expect(afterFirst).toBe(1);

    // SQL now "matches" if we kept order 5 — change desired by keeping mock at 5 and doc at 0
    batcher.notifyChange('space-1');
    await vi.advanceTimersByTimeAsync(499);
    expect(queries.filter((q) => q.sql.includes('FROM (VALUES')).length).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(queries.filter((q) => q.sql.includes('FROM (VALUES')).length).toBe(2);
  });

  it('flushPendingAll drains all pending spaces', async () => {
    vi.useFakeTimers();
    const doc = makeDoc([ID_A]);
    const mockMgr = { getDocIfLoaded: vi.fn().mockReturnValue(doc) };
    const { mockPool, queries } = makePool({
      currentRows: [{ id: ID_A, collection_id: COL_1, order_index: 5 }],
    });

    const batcher = new SyncBatcher(mockMgr as any, 500, () => mockPool as any, 2000);
    batcher.notifyChange('space-1');
    batcher.notifyChange('space-2');
    await batcher.flushPendingAll();

    const begins = queries.filter((q) => q.sql === 'BEGIN').length;
    expect(begins).toBe(2);
  });
});
