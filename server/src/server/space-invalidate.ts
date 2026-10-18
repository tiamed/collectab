/**
 * Wired from index.ts so REST bookmark handlers can invalidate in-memory CRDT rooms
 * after SQL order/collection writes (flush pending then evict → next access re-seeds).
 */
type InvalidateFn = (spaceId: string) => Promise<void>;

let invalidateFn: InvalidateFn | null = null;

export function setSpaceInvalidator(fn: InvalidateFn): void {
  invalidateFn = fn;
}

export async function invalidateSpace(spaceId: string): Promise<void> {
  if (invalidateFn) await invalidateFn(spaceId);
}
