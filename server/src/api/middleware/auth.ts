import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { auth } from '../../auth/auth.js';

export type AuthEnv = {
  Variables: {
    userId: string;
    userEmail: string;
    userRole: string;
  };
};

export async function authMiddleware(c: Context<AuthEnv>, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid authorization header' });
  }

  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    throw new HTTPException(401, { message: 'Invalid or expired session' });
  }

  c.set('userId', session.user.id);
  c.set('userEmail', session.user.email);
  c.set('userRole', (session.user as { role?: string }).role ?? 'guest');
  await next();
}
