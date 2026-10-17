import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../database/client.js';
import { spaces, spaceMembers, users, orgMembers, organizations } from '../../database/schema.js';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';
import { getEffectiveRole } from './permissions.js';

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'viewer']).default('viewer'),
});

const updateMemberSchema = z.object({
  role: z.enum(['editor', 'viewer']),
});

export const memberRoutes = new Hono<AuthEnv>();
memberRoutes.use('*', authMiddleware);

// List members of a space
memberRoutes.get('/:spaceId', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const spaceId = c.req.param('spaceId');

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
  if (!space) {
    return c.json({ error: 'Space not found' }, 404);
  }

  const role = await getEffectiveRole(db, space, userId);
  if (!role) {
    return c.json({ error: 'Space not found' }, 404);
  }

  const members = await db
    .select({
      userId: spaceMembers.userId,
      role: spaceMembers.role,
      createdAt: spaceMembers.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(spaceMembers)
    .innerJoin(users, eq(spaceMembers.userId, users.id))
    .where(eq(spaceMembers.spaceId, spaceId));

  // Include owner info
  const [owner] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, space.ownerId));

  return c.json({ owner, members });
});

// Add a member by email
memberRoutes.post('/:spaceId', zValidator('json', addMemberSchema), async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const spaceId = c.req.param('spaceId');
  const { email, role } = c.req.valid('json');

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
  if (!space || (await getEffectiveRole(db, space, userId)) !== 'owner') {
    return c.json({ error: 'Only the owner can add members' }, 403);
  }

  const [targetUser] = await db.select().from(users).where(eq(users.email, email));
  if (!targetUser) {
    return c.json({ error: 'User not found with that email' }, 404);
  }

  if (targetUser.id === userId) {
    return c.json({ error: 'Cannot add yourself as a member' }, 400);
  }

  // Org spaces: target must already be an org member
  if (space.orgId) {
    const [orgMembership] = await db.select().from(orgMembers)
      .where(and(eq(orgMembers.orgId, space.orgId), eq(orgMembers.userId, targetUser.id)));

    const [org] = await db.select().from(organizations).where(eq(organizations.id, space.orgId));
    const isOrgOwner = org?.ownerId === targetUser.id;

    if (!orgMembership && !isOrgOwner) {
      return c.json({ error: 'User must be an org member first' }, 403);
    }
  }

  const [existing] = await db.select().from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, targetUser.id)));
  if (existing) {
    return c.json({ error: 'User is already a member' }, 409);
  }

  await db.insert(spaceMembers).values({
    spaceId,
    userId: targetUser.id,
    role,
  });

  return c.json({
    member: { userId: targetUser.id, email: targetUser.email, name: targetUser.name, role },
  }, 201);
});

// Update member role
memberRoutes.put('/:spaceId/:memberId', zValidator('json', updateMemberSchema), async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const spaceId = c.req.param('spaceId');
  const memberId = c.req.param('memberId');
  const { role } = c.req.valid('json');

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
  if (!space || (await getEffectiveRole(db, space, userId)) !== 'owner') {
    return c.json({ error: 'Only the owner can change roles' }, 403);
  }

  await db.update(spaceMembers)
    .set({ role })
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, memberId)));

  return c.json({ success: true });
});

// Remove a member
memberRoutes.delete('/:spaceId/:memberId', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const spaceId = c.req.param('spaceId');
  const memberId = c.req.param('memberId');

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
  const isOwner = space ? (await getEffectiveRole(db, space, userId)) === 'owner' : false;
  // Owner can remove anyone; members can remove themselves
  if (!space || (!isOwner && memberId !== userId)) {
    return c.json({ error: 'Not authorized' }, 403);
  }

  await db.delete(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, memberId)));

  return c.body(null, 204);
});
