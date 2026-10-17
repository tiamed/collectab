import type pg from 'pg';
import { getPool } from '../database/client.js';
import type { ShadowDocManager } from './shadow-doc-manager.js';

interface PendingTimers {
  trailing: ReturnType<typeof setTimeout> | null;
  maxWait: ReturnType<typeof setTimeout> | null;
}

/**
 * Debounced batch writer: CRDT list order → bookmarks.order_index / collection_id.
 * Trailing quiet window + maxWait ceiling so continuous edits still flush.
 */
export class SyncBatcher {
  private pending = new Map<string, PendingTimers>();

  constructor(
    private mgr: ShadowDocManager,
    private debounceMs = 500,
    private poolGetter: () => pg.Pool = getPool,
    private maxWaitMs = 2000,
  ) {}

  notifyChange(spaceId: string): void {
    let entry = this.pending.get(spaceId);
    if (!entry) {
      entry = { trailing: null, maxWait: null };
      this.pending.set(spaceId, entry);
    }

    if (entry.trailing) clearTimeout(entry.trailing);
    entry.trailing = setTimeout(() => void this.flush(spaceId), this.debounceMs);

    if (!entry.maxWait && this.maxWaitMs > 0) {
      entry.maxWait = setTimeout(() => void this.flush(spaceId), this.maxWaitMs);
    }
  }

  private clearTimers(spaceId: string): void {
    const entry = this.pending.get(spaceId);
    if (!entry) return;
    if (entry.trailing) clearTimeout(entry.trailing);
    if (entry.maxWait) clearTimeout(entry.maxWait);
    this.pending.delete(spaceId);
  }

  private async flush(spaceId: string): Promise<void> {
    this.clearTimers(spaceId);

    const doc = this.mgr.getDocIfLoaded(spaceId);
    if (!doc) return;

    const pool = this.poolGetter();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const colResult = await client.query(
        'SELECT id FROM collections WHERE space_id = $1 ORDER BY order_index',
        [spaceId],
      );
      const colIds: string[] = colResult.rows.map((r: { id: string }) => r.id);
      if (colIds.length === 0) {
        await client.query('COMMIT');
        return;
      }

      const currentResult = await client.query(
        `SELECT b.id, b.collection_id, b.order_index
         FROM bookmarks b
         INNER JOIN collections c ON c.id = b.collection_id
         WHERE c.space_id = $1`,
        [spaceId],
      );
      const current = new Map<string, { collectionId: string; orderIndex: number }>();
      for (const row of currentResult.rows as { id: string; collection_id: string; order_index: number }[]) {
        current.set(row.id, { collectionId: row.collection_id, orderIndex: row.order_index });
      }

      const values: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      for (const colId of colIds) {
        const list = doc.getList(colId);
        for (let i = 0; i < list.length; i++) {
          const id = list.get(i) as string;
          const prev = current.get(id);
          // Rows not in SQL yet: skip (doc-only); rows not in doc: never touched
          if (!prev) continue;
          if (prev.collectionId === colId && prev.orderIndex === i) continue;

          values.push(`($${paramIdx}::uuid, $${paramIdx + 1}::uuid, $${paramIdx + 2}::int)`);
          params.push(id, colId, i);
          paramIdx += 3;
        }
      }

      if (values.length > 0) {
        await client.query(
          `UPDATE bookmarks AS b SET collection_id = v.collection_id, order_index = v.order_index
           FROM (VALUES ${values.join(', ')}) AS v(id, collection_id, order_index)
           WHERE b.id = v.id`,
          params,
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`SyncBatcher flush failed for space ${spaceId}:`, err);
    } finally {
      client.release();
    }
  }

  async flushNow(spaceId: string): Promise<void> {
    await this.flush(spaceId);
  }

  async flushPendingAll(): Promise<void> {
    const ids = [...this.pending.keys()];
    await Promise.all(ids.map((id) => this.flushNow(id)));
  }
}
