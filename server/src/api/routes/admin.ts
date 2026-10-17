import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../../auth/auth.js';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';
import { isAdmin } from '../../auth/roles.js';

export const adminRoutes = new Hono<AuthEnv>();

adminRoutes.use('*', authMiddleware);
adminRoutes.use('*', async (c, next) => {
  if (!isAdmin({ id: c.get('userId'), role: c.get('userRole') })) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

const createInviteSchema = z.object({
  email: z.string().email().optional(),
  role: z.string().default('user'),
  maxUses: z.number().int().min(1).optional(),
  expiresIn: z.number().int().min(60).optional(),
});

adminRoutes.get('/users', async (c) => {
  const result = await auth.api.listUsers({
    query: {
      limit: Number(c.req.query('limit') ?? 100),
      offset: Number(c.req.query('offset') ?? 0),
      searchValue: c.req.query('search') ?? undefined,
      searchField: c.req.query('search') ? 'email' : undefined,
    },
    headers: c.req.raw.headers,
  });
  return c.json(result);
});

const setRoleSchema = z.object({
  userId: z.string(),
  role: z.enum(['guest', 'user', 'admin']),
});

adminRoutes.post('/set-role', zValidator('json', setRoleSchema), async (c) => {
  const { userId, role } = c.req.valid('json');
  const result = await auth.api.setRole({
    body: { userId, role },
    headers: c.req.raw.headers,
  });
  return c.json(result);
});

const setPasswordSchema = z.object({
  userId: z.string(),
  newPassword: z.string().min(8),
});

adminRoutes.post('/set-password', zValidator('json', setPasswordSchema), async (c) => {
  const { userId, newPassword } = c.req.valid('json');
  const result = await auth.api.setUserPassword({
    body: { userId, newPassword },
    headers: c.req.raw.headers,
  });
  return c.json(result);
});

adminRoutes.post('/invite', zValidator('json', createInviteSchema), async (c) => {
  const { email, role, maxUses, expiresIn } = c.req.valid('json');
  const result = await auth.api.createInvite({
    body: {
      email,
      role,
      maxUses,
      expiresIn,
    },
    headers: c.req.raw.headers,
  });
  return c.json(result, 201);
});

adminRoutes.get('/invites', async (c) => {
  const result = await auth.api.listInvites({
    query: {
      limit: Number(c.req.query('limit') ?? 100),
      offset: Number(c.req.query('offset') ?? 0),
    },
    headers: c.req.raw.headers,
  });
  return c.json(result);
});
