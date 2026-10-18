/**
 * Role-matrix acceptance tests covering the plan verification matrix.
 * Mocks getEffectiveRole / canEditSpace; DB stub returns seeded rows without
 * parsing drizzle SQL (avoids circular-structure walkers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { generateTestToken } from './helpers.js';

const OWNER = 'owner-id';
const ADMIN = 'admin-id';
const MEMBER = 'member-id';
const OUTSIDER = 'outsider-id';
const ORG_ID = 'org-id';
const SPACE_ID = 'space-id';
const COL_ID = 'col-id';
const BM_ID = 'bm-id';

const roles = new Map<string, 'owner' | 'editor' | 'viewer' | null>([
  [OWNER, 'owner'],
  [ADMIN, 'editor'],
  [MEMBER, 'viewer'],
  [OUTSIDER, null],
]);

vi.mock('../src/api/routes/permissions.js', () => ({
  getEffectiveRole: vi.fn(async (_db: unknown, _space: unknown, userId: string) => roles.get(userId) ?? null),
  canEditSpace: vi.fn(async (_db: unknown, _space: unknown, userId: string) => {
    const r = roles.get(userId);
    return r === 'owner' || r === 'editor';
  }),
  isSpaceOwner: vi.fn(async (_db: unknown, _space: unknown, userId: string) => roles.get(userId) === 'owner'),
}));

const spaceMembers: { spaceId: string; userId: string; role: string }[] = [];
const orgMembers: { orgId: string; userId: string; role: string }[] = [];

const org = { id: ORG_ID, name: 'Acme', icon: '🏢', ownerId: OWNER, createdAt: new Date() };
const space = {
  id: SPACE_ID, orgId: ORG_ID, ownerId: OWNER, name: 'Eng', icon: '💼',
  orderIndex: 0, createdAt: new Date(),
};
const personalSpace = {
  id: 'personal-space', orgId: null as string | null, ownerId: OWNER, name: 'Personal', icon: '💼',
  orderIndex: 0, createdAt: new Date(),
};
const collection = {
  id: COL_ID, spaceId: SPACE_ID, ownerId: OWNER, name: 'Links', icon: '📁',
  color: '#9761da', orderIndex: 0, createdAt: new Date(), updatedAt: new Date(),
};
const bookmark = {
  id: BM_ID, collectionId: COL_ID, title: 'Example', url: 'https://example.com',
  description: null as string | null, favicon: null as string | null, tags: [] as string[], orderIndex: 0,
  createdAt: new Date(), updatedAt: new Date(),
};

const users = [
  { id: OWNER, email: 'owner@test.com', name: 'Owner' },
  { id: ADMIN, email: 'admin@test.com', name: 'Admin' },
  { id: MEMBER, email: 'member@test.com', name: 'Member' },
  { id: OUTSIDER, email: 'outsider@test.com', name: 'Outsider' },
  { id: 'admin2-id', email: 'admin2@test.com', name: 'A2' },
];

/** Last email / space id looked up */
let lastEmailLookup: string | null = null;
let lastSpaceId: string | null = null;
let spaceMemberEmpty = false;
let orgMemberEmpty = false;

vi.mock('../src/database/client.js', () => {
  const mockDb: any = {
    select: () => ({
      from: (table: any) => {
        const name = detect(table);
        const resolve = () => {
          if (name === 'spaces') {
            if (lastSpaceId === 'personal-space') return [personalSpace];
            if (lastSpaceId === SPACE_ID || !lastSpaceId) return [space];
            return [space, personalSpace].filter((s) => s.id === lastSpaceId);
          }
          if (name === 'collections') return [collection];
          if (name === 'bookmarks') return [bookmark];
          if (name === 'organizations') return [org];
          if (name === 'orgMembers') {
            if (orgMemberEmpty) return [];
            const admin2 = orgMembers.find((m) => m.userId === 'admin2-id');
            if (admin2) return [admin2, ...orgMembers.filter((m) => m !== admin2)];
            return [...orgMembers];
          }
          if (name === 'spaceMembers') return spaceMemberEmpty ? [] : [...spaceMembers];
          if (name === 'users') {
            if (lastEmailLookup) {
              const u = users.find((x) => x.email === lastEmailLookup);
              lastEmailLookup = null;
              return u ? [u] : [];
            }
            return users;
          }
          return [];
        };

        const chain: any = {
          where: () => chain,
          innerJoin: () => chain,
          orderBy: () => Promise.resolve(resolve()),
          then: (r: any, j?: any) => Promise.resolve(resolve()).then(r, j),
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (data: any) => {
        const name = detect(table);
        const rows = Array.isArray(data) ? data : [data];
        if (name === 'spaceMembers') for (const d of rows) spaceMembers.push(d);
        if (name === 'orgMembers') {
          for (const d of rows) {
            const ex = orgMembers.find((m) => m.orgId === d.orgId && m.userId === d.userId);
            if (ex) ex.role = d.role;
            else orgMembers.push(d);
          }
        }
        const created = rows.map((d) => ({
          ...d,
          id: d.id || (name === 'spaces' ? 'new-space' : 'new'),
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        return {
          returning: () => Promise.resolve(created),
          onConflictDoUpdate: ({ set }: any) => {
            for (const d of rows) {
              const ex = orgMembers.find((m) => m.orgId === d.orgId && m.userId === d.userId);
              if (ex && set?.role) ex.role = set.role;
            }
            return Promise.resolve();
          },
        };
      },
    }),
    update: () => ({
      set: (data: any) => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...space, ...data }, { ...bookmark, ...data }]),
        }),
      }),
    }),
    delete: (table: any) => ({
      where: () => {
        const name = detect(table);
        // Cascade path deletes by member id — tests assert after owner removes MEMBER
        if (name === 'orgMembers') {
          const idx = orgMembers.findIndex((m) => m.userId === MEMBER);
          if (idx >= 0) orgMembers.splice(idx, 1);
        }
        if (name === 'spaceMembers') {
          for (let i = spaceMembers.length - 1; i >= 0; i--) {
            if (spaceMembers[i].userId === MEMBER) spaceMembers.splice(i, 1);
          }
        }
        return Promise.resolve();
      },
    }),
    transaction: async (fn: (tx: any) => Promise<any>) => fn(mockDb),
  };

  return { getDb: () => mockDb };
});

function detect(table: any): string {
  if (table?.passwordHash || table?.avatarUrl) return 'users';
  if (table?.collectionId && table?.url) return 'bookmarks';
  if (table?.spaceId && table?.color) return 'collections';
  if (table?.spaceId && table?.userId && table?.role) return 'spaceMembers';
  if (table?.orgId && table?.userId && table?.role && !table?.spaceId) return 'orgMembers';
  if (table?.orderIndex !== undefined && table?.ownerId && table?.orgId !== undefined) return 'spaces';
  if (table?.ownerId && table?.name && !table?.spaceId) return 'organizations';
  if (table?.email && table?.name) return 'users';
  return 'unknown';
}

// Patch via module-level lookup hints (lastEmailLookup / lastSpaceId)

const { spaceRoutes } = await import('../src/api/routes/spaces.js');
const { collectionRoutes } = await import('../src/api/routes/collections.js');
const { bookmarkRoutes } = await import('../src/api/routes/bookmarks.js');
const { memberRoutes } = await import('../src/api/routes/members.js');
const { orgRoutes } = await import('../src/api/routes/organizations.js');

function createApp() {
  const app = new Hono();
  app.use('*', cors());
  app.route('/api/spaces', spaceRoutes);
  app.route('/api/collections', collectionRoutes);
  app.route('/api/bookmarks', bookmarkRoutes);
  app.route('/api/members', memberRoutes);
  app.route('/api/orgs', orgRoutes);
  return app;
}

function hdr(userId: string, email: string) {
  return { Authorization: `Bearer ${generateTestToken(userId, email)}`, 'Content-Type': 'application/json' };
}

/** Set which email the next users lookup should resolve */
function expectEmail(email: string) {
  lastEmailLookup = email;
}

function expectSpace(id: string) {
  lastSpaceId = id;
}

function expectNoSpaceMembership() {
  spaceMemberEmpty = true;
}

function expectNoOrgMembership() {
  orgMemberEmpty = true;
}

describe('Permission role matrix', () => {
  const app = createApp();

  beforeEach(() => {
    spaceMembers.length = 0;
    spaceMembers.push(
      { spaceId: SPACE_ID, userId: OWNER, role: 'owner' },
      { spaceId: SPACE_ID, userId: ADMIN, role: 'editor' },
      { spaceId: SPACE_ID, userId: MEMBER, role: 'viewer' },
    );
    orgMembers.length = 0;
    orgMembers.push(
      { orgId: ORG_ID, userId: ADMIN, role: 'admin' },
      { orgId: ORG_ID, userId: MEMBER, role: 'member' },
    );
    roles.set(OWNER, 'owner');
    roles.set(ADMIN, 'editor');
    roles.set(MEMBER, 'viewer');
    roles.set(OUTSIDER, null);
    lastEmailLookup = null;
    lastSpaceId = SPACE_ID;
    spaceMemberEmpty = false;
    orgMemberEmpty = false;
  });

  it('outsider → org-space invite = 403', async () => {
    expectSpace(SPACE_ID);
    expectEmail('outsider@test.com');
    expectNoSpaceMembership();
    expectNoOrgMembership();
    const res = await app.request(`/api/members/${SPACE_ID}`, {
      method: 'POST',
      headers: hdr(OWNER, 'owner@test.com'),
      body: JSON.stringify({ email: 'outsider@test.com', role: 'viewer' }),
    });
    expect(res.status).toBe(403);
  });

  it('member → edit bookmark = 403', async () => {
    const res = await app.request(`/api/bookmarks/${BM_ID}`, {
      method: 'PUT',
      headers: hdr(MEMBER, 'member@test.com'),
      body: JSON.stringify({ title: 'Nope' }),
    });
    expect(res.status).toBe(403);
  });

  it('admin → edit bookmark = 200', async () => {
    const res = await app.request(`/api/bookmarks/${BM_ID}`, {
      method: 'PUT',
      headers: hdr(ADMIN, 'admin@test.com'),
      body: JSON.stringify({ title: 'Yes' }),
    });
    expect(res.status).toBe(200);
  });

  it('admin → change org member role = 403', async () => {
    expectEmail('member@test.com');
    const res = await app.request(`/api/orgs/${ORG_ID}/members`, {
      method: 'POST',
      headers: hdr(ADMIN, 'admin@test.com'),
      body: JSON.stringify({ email: 'member@test.com', role: 'admin' }),
    });
    expect(res.status).toBe(403);
  });

  it('admin → rename space (not theirs) = 404', async () => {
    const res = await app.request(`/api/spaces/${SPACE_ID}`, {
      method: 'PUT',
      headers: hdr(ADMIN, 'admin@test.com'),
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('owner → rename space = 200', async () => {
    const res = await app.request(`/api/spaces/${SPACE_ID}`, {
      method: 'PUT',
      headers: hdr(OWNER, 'owner@test.com'),
      body: JSON.stringify({ name: 'Eng 2' }),
    });
    expect(res.status).toBe(200);
  });

  it('Personal space invite outsider → 201', async () => {
    expectSpace('personal-space');
    expectEmail('outsider@test.com');
    expectNoSpaceMembership();
    const res = await app.request(`/api/members/personal-space`, {
      method: 'POST',
      headers: hdr(OWNER, 'owner@test.com'),
      body: JSON.stringify({ email: 'outsider@test.com', role: 'viewer' }),
    });
    expect(res.status).toBe(201);
  });

  it('shared personal space member → list collections = 200', async () => {
    roles.set(OUTSIDER, 'viewer');
    expectSpace('personal-space');
    const res = await app.request('/api/collections?spaceId=personal-space', {
      headers: hdr(OUTSIDER, 'outsider@test.com'),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collections.length).toBeGreaterThan(0);
  });

  it('outsider → personal space collections = 403', async () => {
    roles.set(OUTSIDER, null);
    expectSpace('personal-space');
    const res = await app.request('/api/collections?spaceId=personal-space', {
      headers: hdr(OUTSIDER, 'outsider@test.com'),
    });
    expect(res.status).toBe(403);
  });

  it('remove org member cascades space_members', async () => {
    expect(spaceMembers.some((m) => m.userId === MEMBER)).toBe(true);
    const res = await app.request(`/api/orgs/${ORG_ID}/members/${MEMBER}`, {
      method: 'DELETE',
      headers: hdr(OWNER, 'owner@test.com'),
    });
    expect(res.status).toBe(204);
    expect(orgMembers.some((m) => m.userId === MEMBER)).toBe(false);
    expect(spaceMembers.some((m) => m.userId === MEMBER)).toBe(false);
  });

  it('admin cannot remove another admin', async () => {
    orgMembers.push({ orgId: ORG_ID, userId: 'admin2-id', role: 'admin' });
    // delete mock always removes MEMBER — need smarter delete for this case.
    // Instead verify status: when target is admin, route returns 403 before delete.
    const res = await app.request(`/api/orgs/${ORG_ID}/members/admin2-id`, {
      method: 'DELETE',
      headers: hdr(ADMIN, 'admin@test.com'),
    });
    expect(res.status).toBe(403);
  });

  it('admin cannot remove the owner', async () => {
    const res = await app.request(`/api/orgs/${ORG_ID}/members/${OWNER}`, {
      method: 'DELETE',
      headers: hdr(ADMIN, 'admin@test.com'),
    });
    expect(res.status).toBe(403);
  });

  it('admin can only add role=member', async () => {
    expectEmail('outsider@test.com');
    const res = await app.request(`/api/orgs/${ORG_ID}/members`, {
      method: 'POST',
      headers: hdr(ADMIN, 'admin@test.com'),
      body: JSON.stringify({ email: 'outsider@test.com', role: 'admin' }),
    });
    expect(res.status).toBe(403);
  });
});
