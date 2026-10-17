import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, asc, and, isNull, not } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../database/client.js';
import { spaces, spaceMembers, orgMembers, organizations, users } from '../../database/schema.js';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';
import { getEffectiveRole } from './permissions.js';

const createSchema = z.object({
  name: z.string().min(1).max(255),
  icon: z.string().max(2048).optional(),
  orgId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  icon: z.string().max(2048).optional(),
  orderIndex: z.number().int().min(0).optional(),
});

export const spaceRoutes = new Hono<AuthEnv>();
spaceRoutes.use('*', authMiddleware);

spaceRoutes.get('/', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const orgId = c.req.query('orgId');

  if (orgId) {
    // Verify user has access to this org (owner or member)
    const [membership] = await db.select().from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

    // Also check if user is the org owner
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org || (org.ownerId !== userId && !membership)) {
      return c.json({ error: 'No access to this organization' }, 403);
    }

    // Org members may open the org; they only see spaces they were invited to
    // (or created). The org owner sees every space.
    const orgSpaces = await db
      .select()
      .from(spaces)
      .where(eq(spaces.orgId, orgId))
      .orderBy(asc(spaces.orderIndex));

    if (org.ownerId === userId) {
      return c.json({
        spaces: orgSpaces.map((s) => ({ ...s, myRole: 'owner' as const })),
      });
    }

    const memberRows = await db
      .select({ spaceId: spaceMembers.spaceId, role: spaceMembers.role })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, userId));
    const roleBySpace = new Map(memberRows.map((r) => [r.spaceId, r.role]));

    const visible = orgSpaces
      .map((s) => {
        let myRole: 'owner' | 'editor' | 'viewer' | null = null;
        if (s.ownerId === userId) myRole = 'owner';
        else {
          const r = roleBySpace.get(s.id);
          if (r === 'owner' || r === 'editor' || r === 'viewer') myRole = r;
        }
        return myRole ? { ...s, myRole } : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return c.json({ spaces: visible });
  }

  // No orgId: return user's personal spaces (no org) + shared spaces
  const owned = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.ownerId, userId), isNull(spaces.orgId)))
    .orderBy(asc(spaces.orderIndex));

  const shared = await db
    .select({ space: spaces, ownerName: users.name, role: spaceMembers.role })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaceMembers.spaceId, spaces.id))
    .innerJoin(users, eq(users.id, spaces.ownerId))
    .where(and(eq(spaceMembers.userId, userId), isNull(spaces.orgId), not(eq(spaces.ownerId, userId))))
    .orderBy(asc(spaces.orderIndex));

  const allSpaces = [
    ...owned.map((s) => ({ ...s, isShared: false, myRole: 'owner' as const })),
    ...shared.map(({ space, ownerName, role }) => ({
      ...space,
      isShared: true,
      ownerName,
      myRole: (role === 'owner' || role === 'editor' || role === 'viewer' ? role : 'viewer') as
        | 'owner'
        | 'editor'
        | 'viewer',
    })),
  ];

  return c.json({ spaces: allSpaces });
});

spaceRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const { name, icon, orgId } = c.req.valid('json');

  let org: typeof organizations.$inferSelect | null = null;

  if (orgId) {
    // Verify user has access to org (owner or admin)
    const [found] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!found) return c.json({ error: 'Organization not found' }, 404);
    org = found;

    const [membership] = await db.select().from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));

    if (org.ownerId !== userId && (!membership || membership.role !== 'admin')) {
      return c.json({ error: 'Only org owner/admin can create spaces' }, 403);
    }
  }

  const space = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(spaces)
      .values({ ownerId: userId, name, icon: icon || '💼', orgId: orgId || null })
      .returning();

    // Org spaces: auto-insert all org members with derived roles
    if (orgId && org) {
      const members = await tx
        .select({ userId: orgMembers.userId, role: orgMembers.role })
        .from(orgMembers)
        .where(eq(orgMembers.orgId, orgId));

      const memberRows: { spaceId: string; userId: string; role: string }[] = [];
      const seen = new Set<string>();

      // Space creator is always space owner
      memberRows.push({ spaceId: created.id, userId, role: 'owner' });
      seen.add(userId);

      // Org owner → space owner (if different from creator)
      if (org.ownerId !== userId) {
        memberRows.push({ spaceId: created.id, userId: org.ownerId, role: 'owner' });
        seen.add(org.ownerId);
      }

      for (const m of members) {
        if (seen.has(m.userId)) continue;
        const role = m.role === 'admin' ? 'editor' : 'viewer';
        memberRows.push({ spaceId: created.id, userId: m.userId, role });
        seen.add(m.userId);
      }

      if (memberRows.length > 0) {
        await tx.insert(spaceMembers).values(memberRows);
      }
    }

    return created;
  });

  return c.json({ space: { ...space, myRole: 'owner' as const } }, 201);
});

spaceRoutes.put('/:id', zValidator('json', updateSchema), async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existing] = await db.select().from(spaces).where(eq(spaces.id, id));
  if (!existing || (await getEffectiveRole(db, existing, userId)) !== 'owner') {
    return c.json({ error: 'Space not found' }, 404);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.icon !== undefined) updates.icon = body.icon;
  if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;

  const [updated] = await db.update(spaces).set(updates).where(eq(spaces.id, id)).returning();
  return c.json({ space: updated });
});

spaceRoutes.delete('/:id', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const id = c.req.param('id');

  const [existing] = await db.select().from(spaces).where(eq(spaces.id, id));
  if (!existing || (await getEffectiveRole(db, existing, userId)) !== 'owner') {
    return c.json({ error: 'Space not found' }, 404);
  }

  await db.delete(spaces).where(eq(spaces.id, id));
  return c.body(null, 204);
});

// Delete all spaces in an org (or personal if no orgId)
spaceRoutes.delete('/', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const orgId = c.req.query('orgId');

  if (orgId) {
    await db.delete(spaces).where(and(eq(spaces.ownerId, userId), eq(spaces.orgId, orgId)));
  } else {
    await db.delete(spaces).where(and(eq(spaces.ownerId, userId), isNull(spaces.orgId)));
  }

  return c.body(null, 204);
});
