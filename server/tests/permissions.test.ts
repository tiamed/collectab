import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEffectiveRole, canEditSpace, isSpaceOwner, hasSpaceAccess } from '../src/api/routes/permissions.js';

type Row = Record<string, unknown>;

/**
 * Minimal queryable mock: tables keyed by symbol name heuristics via
 * a push/pop queue of result sets configured per test.
 */
let queue: Row[][] = [];

function enqueue(...sets: Row[][]) {
  queue.push(...sets);
}

function makeDb() {
  const chain = (): any => {
    const c: any = {
      where: () => c,
      orderBy: () => Promise.resolve(dequeue()),
      then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
        Promise.resolve(dequeue()).then(resolve, reject),
    };
    return c;
  };

  function dequeue(): Row[] {
    return queue.shift() ?? [];
  }

  return {
    select: () => ({
      from: () => chain(),
    }),
  };
}

describe('getEffectiveRole', () => {
  beforeEach(() => {
    queue = [];
  });

  it('returns null for missing space', async () => {
    const db = makeDb() as any;
    expect(await getEffectiveRole(db, null, 'u1')).toBeNull();
    expect(await getEffectiveRole(db, undefined, 'u1')).toBeNull();
  });

  it('Personal: ownerId match → owner (no org query)', async () => {
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'u1', orgId: null };
    expect(await getEffectiveRole(db, space, 'u1')).toBe('owner');
    expect(queue).toHaveLength(0); // must not query org
  });

  it('Personal: non-owner with space_members editor → editor', async () => {
    enqueue([{ role: 'editor' }]);
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'owner', orgId: null };
    expect(await getEffectiveRole(db, space, 'u2')).toBe('editor');
  });

  it('Personal: non-owner with no space_members → null', async () => {
    enqueue([]);
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'owner', orgId: null };
    expect(await getEffectiveRole(db, space, 'stranger')).toBeNull();
  });

  it('Org: org owner → owner (supreme)', async () => {
    enqueue([{ ownerId: 'org-owner' }]); // organizations lookup
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'creator', orgId: 'org1' };
    expect(await getEffectiveRole(db, space, 'org-owner')).toBe('owner');
  });

  it('Org: space creator → owner even if not org owner', async () => {
    enqueue([{ ownerId: 'org-owner' }]); // org lookup — not matching
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'creator', orgId: 'org1' };
    expect(await getEffectiveRole(db, space, 'creator')).toBe('owner');
  });

  it('Org: space_members editor → editor', async () => {
    enqueue([{ ownerId: 'org-owner' }], [{ role: 'editor' }]);
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'creator', orgId: 'org1' };
    expect(await getEffectiveRole(db, space, 'admin-user')).toBe('editor');
  });

  it('Org: space_members viewer → viewer', async () => {
    enqueue([{ ownerId: 'org-owner' }], [{ role: 'viewer' }]);
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'creator', orgId: 'org1' };
    expect(await getEffectiveRole(db, space, 'member-user')).toBe('viewer');
  });

  it('Org: no space_members row → null even if they could be an org member', async () => {
    enqueue([{ ownerId: 'org-owner' }], []);
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'creator', orgId: 'org1' };
    expect(await getEffectiveRole(db, space, 'org-member')).toBeNull();
    expect(await hasSpaceAccess(db, space, 'org-member')).toBe(false);
  });

  it('isSpaceOwner / canEditSpace wrappers', async () => {
    const db = makeDb() as any;
    const space = { id: 's1', ownerId: 'u1', orgId: null };
    expect(await isSpaceOwner(db, space, 'u1')).toBe(true);
    expect(await canEditSpace(db, space, 'u1')).toBe(true);

    enqueue([{ role: 'viewer' }]);
    expect(await canEditSpace(db, { id: 's1', ownerId: 'owner', orgId: null }, 'v1')).toBe(false);

    enqueue([{ role: 'editor' }]);
    expect(await canEditSpace(db, { id: 's1', ownerId: 'owner', orgId: null }, 'e1')).toBe(true);
  });
});
