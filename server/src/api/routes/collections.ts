import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../database/client.js';
import { collections, spaces } from '../../database/schema.js';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';
import { canEditSpace, getEffectiveRole } from './permissions.js';

const createSchema = z.object({
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  icon: z.string().max(2048).optional(),
  color: z.string().max(7).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  icon: z.string().max(2048).optional(),
  color: z.string().max(7).optional(),
  orderIndex: z.number().int().min(0).optional(),
  spaceId: z.string().uuid().optional(),
});

export const collectionRoutes = new Hono<AuthEnv>();
collectionRoutes.use('*', authMiddleware);

collectionRoutes.get('/', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const spaceId = c.req.query('spaceId');

  if (spaceId) {
    const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
    if (!space) return c.json({ collections: [] });

    // Owner, space member (shared personal/org), or org member may list all collections in the space
    const role = await getEffectiveRole(db, space, userId);
    if (!role) {
      return c.json({ error: 'No access' }, 403);
    }

    const result = await db.select().from(collections)
      .where(eq(collections.spaceId, spaceId))
      .orderBy(asc(collections.orderIndex));
    return c.json({ collections: result });
  }

  // No spaceId: return user's own collections
  const result = await db.select().from(collections)
    .where(eq(collections.ownerId, userId))
    .orderBy(asc(collections.orderIndex));
  return c.json({ collections: result });
});

collectionRoutes.post('/', zValidator('json', createSchema), async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const { spaceId, name, icon, color } = c.req.valid('json');

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId));
  if (!space || !(await canEditSpace(db, space, userId))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [collection] = await db
    .insert(collections)
    .values({
      spaceId,
      ownerId: userId,
      name,
      icon: icon || '📁',
      color: color || '#9761da',
    })
    .returning();

  return c.json({ collection }, 201);
});

collectionRoutes.put('/:id', zValidator('json', updateSchema), async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existing] = await db.select().from(collections).where(eq(collections.id, id));
  if (!existing) {
    return c.json({ error: 'Collection not found' }, 404);
  }

  const [space] = await db.select().from(spaces).where(eq(spaces.id, existing.spaceId));
  if (!space || !(await canEditSpace(db, space, userId))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (body.spaceId && body.spaceId !== existing.spaceId) {
    const [targetSpace] = await db.select().from(spaces).where(eq(spaces.id, body.spaceId));
    if (!targetSpace || !(await canEditSpace(db, targetSpace, userId))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.icon !== undefined) updates.icon = body.icon;
  if (body.color !== undefined) updates.color = body.color;
  if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex;
  if (body.spaceId !== undefined) updates.spaceId = body.spaceId;

  const [updated] = await db.update(collections).set(updates).where(eq(collections.id, id)).returning();
  return c.json({ collection: updated });
});

collectionRoutes.delete('/:id', async (c) => {
  const db = getDb();
  const userId = c.get('userId');
  const id = c.req.param('id');

  const [existing] = await db.select().from(collections).where(eq(collections.id, id));
  if (!existing) {
    return c.json({ error: 'Collection not found' }, 404);
  }

  const [space] = await db.select().from(spaces).where(eq(spaces.id, existing.spaceId));
  if (!space || !(await canEditSpace(db, space, userId))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.delete(collections).where(eq(collections.id, id));
  return c.body(null, 204);
});
