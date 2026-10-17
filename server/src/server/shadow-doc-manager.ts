import { LoroDoc } from 'loro-crdt';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '../database/client.js';
import { collections, bookmarks } from '../database/schema.js';

interface ShadowRoom {
  doc: LoroDoc;
  lastAccessed: number;
}

/**
 * Per-space LoroDoc holding per-collection bookmark ID lists.
 * Cold start: bootstrap from DB order_index (only allowed mutate).
 * Runtime: importUpdate only.
 */
export class ShadowDocManager {
  private rooms = new Map<string, ShadowRoom>();

  /**
   * Cold start from DB. Unique place that may mutate the doc.
   */
  async getOrCreate(spaceId: string): Promise<LoroDoc> {
    const existing = this.rooms.get(spaceId);
    if (existing) {
      existing.lastAccessed = Date.now();
      return existing.doc;
    }

    const doc = new LoroDoc();
    const db = getDb();

    const cols = await db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.spaceId, spaceId))
      .orderBy(asc(collections.orderIndex));

    for (const col of cols) {
      const bks = await db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(eq(bookmarks.collectionId, col.id))
        .orderBy(asc(bookmarks.orderIndex));

      const list = doc.getList(col.id);
      for (const bk of bks) {
        list.push(bk.id);
      }
    }

    doc.commit();
    this.rooms.set(spaceId, { doc, lastAccessed: Date.now() });
    return doc;
  }

  async importUpdate(spaceId: string, update: Uint8Array): Promise<void> {
    const doc = await this.getOrCreate(spaceId);
    doc.import(update);
  }

  getDocIfLoaded(spaceId: string): LoroDoc | null {
    return this.rooms.get(spaceId)?.doc ?? null;
  }

  getBookmarkIds(spaceId: string, collectionId: string): string[] | null {
    const doc = this.getDocIfLoaded(spaceId);
    if (!doc) return null;
    const list = doc.getList(collectionId);
    const result: string[] = [];
    for (let i = 0; i < list.length; i++) {
      result.push(list.get(i) as string);
    }
    return result;
  }

  /** In-memory Loro export for WS clients — not persisted to DB. */
  getSnapshot(spaceId: string): Uint8Array | null {
    const doc = this.getDocIfLoaded(spaceId);
    if (!doc) return null;
    return doc.export({ mode: 'snapshot' });
  }

  /** Drop in-memory room so next getOrCreate re-seeds from SQL. */
  evict(spaceId: string): void {
    this.rooms.delete(spaceId);
  }

  cleanStaleRooms(maxAgeMs = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (now - room.lastAccessed > maxAgeMs) this.rooms.delete(id);
    }
  }
}
