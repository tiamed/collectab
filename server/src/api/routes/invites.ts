import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auth } from '../../auth/auth.js';
import { checkInvite } from '../../auth/invites.js';
import { ROLES } from '../../auth/roles.js';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';

export const inviteRoutes = new Hono<AuthEnv>();

const roleRank = (role: string | null | undefined) => ROLES.indexOf((role ?? 'guest') as (typeof ROLES)[number]);

/** Lets an existing account redeem an invite (e.g. a guest being upgraded to user). */
inviteRoutes.post('/redeem', authMiddleware, zValidator('json', z.object({ code: z.string().trim().min(1) })), async (c) => {
  const { code } = c.req.valid('json');
  const check = await checkInvite(code, c.get('userEmail'));
  if (!check.ok) return c.json({ error: check.message, code: check.code }, 400);
  if (roleRank(check.invite.role) <= roleRank(c.get('userRole'))) {
    return c.json({ error: 'Your account already has this access level', code: 'INVITE_NOT_NEEDED' }, 400);
  }

  await auth.api.activateInvite({ body: { token: code }, headers: c.req.raw.headers });
  return c.json({ role: check.invite.role });
});
