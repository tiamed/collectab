import { Hono } from 'hono';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';
import { getDb } from '../../database/client.js';
import { users } from '../../database/schema.js';
import { eq } from 'drizzle-orm';
import { isAdmin } from '../../auth/roles.js';

export const meRoutes = new Hono<AuthEnv>();

meRoutes.get('/', authMiddleware, async (c) => {
  const db = getDb();
  const userId = c.get('userId');

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ user: { ...user, isAdmin: isAdmin(user) } });
});
