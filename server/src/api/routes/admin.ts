import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, arrayContains, count, desc, eq, gt, ilike, inArray, max, or, sql } from 'drizzle-orm';
import { auth } from '../../auth/auth.js';
import { getQuotaForRole } from '../../auth/quota.js';
import { inviteLandingUrl, isAdmin, ROLES } from '../../auth/roles.js';
import { countInviteUses, inviteEmails } from '../../auth/invites.js';
import { getEnv } from '../../config/env.js';
import { getDb } from '../../database/client.js';
import { bookmarks, collections, invites, inviteUses, sessions, spaces, users } from '../../database/schema.js';
import { authMiddleware, type AuthEnv } from '../middleware/auth.js';

export const adminRoutes = new Hono<AuthEnv>();

adminRoutes.use('*', authMiddleware);
adminRoutes.use('*', async (c, next) => {
  if (!isAdmin({ id: c.get('userId'), role: c.get('userRole') })) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

const roleSchema = z.enum(ROLES);
const DAY_MS = 24 * 60 * 60 * 1000;

function quotas() {
  return Object.fromEntries(ROLES.map((r) => [r, getQuotaForRole(r)])) as Record<(typeof ROLES)[number], number | null>;
}

/** Changing yourself out of admin, banning or deleting yourself would lock the operator out. */
function forbidSelf(c: { get: (k: 'userId') => string }, userId: string, action: string) {
  return c.get('userId') === userId ? `You can't ${action} your own account` : null;
}

adminRoutes.get('/stats', async (c) => {
  const db = getDb();
  const now = new Date();
  const [byRole, [bm], [recent], [active], [pendingInvites]] = await Promise.all([
    db.select({ role: users.role, n: count() }).from(users).groupBy(users.role),
    db.select({ n: count() }).from(bookmarks),
    db.select({ n: count() }).from(users).where(gt(users.createdAt, new Date(now.getTime() - 7 * DAY_MS))),
    db
      .select({ n: sql<number>`count(distinct ${sessions.userId})::int` })
      .from(sessions)
      .where(and(gt(sessions.expiresAt, now), gt(sessions.updatedAt, new Date(now.getTime() - 7 * DAY_MS)))),
    db.select({ n: count() }).from(invites).where(and(eq(invites.status, 'pending'), gt(invites.expiresAt, now))),
  ]);
  const env = getEnv();
  return c.json({
    users: byRole.reduce((sum, r) => sum + r.n, 0),
    usersByRole: Object.fromEntries(byRole.map((r) => [r.role ?? 'guest', r.n])),
    newUsers7d: recent?.n ?? 0,
    activeUsers7d: active?.n ?? 0,
    bookmarks: bm?.n ?? 0,
    pendingInvites: pendingInvites?.n ?? 0,
    config: {
      inviteMode: env.INVITE_MODE,
      defaultRole: env.DEFAULT_ROLE,
      quotas: quotas(),
      emailEnabled: Boolean(env.RESEND_API_KEY),
    },
  });
});

const listUsersQuery = z.object({
  search: z.string().trim().optional(),
  role: roleSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

adminRoutes.get('/users', zValidator('query', listUsersQuery), async (c) => {
  const { search, role, limit, offset } = c.req.valid('query');
  const db = getDb();
  const env = getEnv();

  const filters = [
    search ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`)) : undefined,
    role ? eq(users.role, role) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        banned: users.banned,
        banReason: users.banReason,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(users).where(where),
  ]);

  const ids = rows.map((r) => r.id);
  const [bookmarkCounts, lastSeen] = ids.length
    ? await Promise.all([
        db
          .select({ userId: spaces.ownerId, n: count() })
          .from(bookmarks)
          .innerJoin(collections, eq(bookmarks.collectionId, collections.id))
          .innerJoin(spaces, eq(collections.spaceId, spaces.id))
          .where(inArray(spaces.ownerId, ids))
          .groupBy(spaces.ownerId),
        db
          .select({ userId: sessions.userId, at: max(sessions.updatedAt) })
          .from(sessions)
          .where(inArray(sessions.userId, ids))
          .groupBy(sessions.userId),
      ])
    : [[], []];
  const bookmarksBy = new Map(bookmarkCounts.map((r) => [r.userId, r.n]));
  const lastSeenBy = new Map(lastSeen.map((r) => [r.userId, r.at]));

  return c.json({
    total: total?.n ?? 0,
    users: rows.map((u) => ({
      ...u,
      role: u.role ?? 'guest',
      banned: !!u.banned,
      isEnvAdmin: env.ADMIN_USER_IDS.includes(u.id),
      bookmarkCount: bookmarksBy.get(u.id) ?? 0,
      quota: getQuotaForRole(u.role),
      lastActiveAt: lastSeenBy.get(u.id) ?? null,
    })),
  });
});

adminRoutes.post('/users/:id/role', zValidator('json', z.object({ role: roleSchema })), async (c) => {
  const userId = c.req.param('id');
  const { role } = c.req.valid('json');
  if (role !== 'admin') {
    const err = forbidSelf(c, userId, 'remove admin from');
    if (err) return c.json({ error: err }, 400);
  }
  await auth.api.setRole({ body: { userId, role }, headers: c.req.raw.headers });
  return c.json({ ok: true, role });
});

adminRoutes.post('/users/:id/password', zValidator('json', z.object({ newPassword: z.string().min(8) })), async (c) => {
  const userId = c.req.param('id');
  await auth.api.setUserPassword({ body: { userId, newPassword: c.req.valid('json').newPassword }, headers: c.req.raw.headers });
  // A reset usually means the account was compromised or shared; end its sessions.
  if (userId !== c.get('userId')) {
    await auth.api.revokeUserSessions({ body: { userId }, headers: c.req.raw.headers });
  }
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/ban', zValidator('json', z.object({ reason: z.string().max(500).optional() })), async (c) => {
  const userId = c.req.param('id');
  const err = forbidSelf(c, userId, 'ban');
  if (err) return c.json({ error: err }, 400);
  await auth.api.banUser({ body: { userId, banReason: c.req.valid('json').reason }, headers: c.req.raw.headers });
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/unban', async (c) => {
  await auth.api.unbanUser({ body: { userId: c.req.param('id') }, headers: c.req.raw.headers });
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/revoke-sessions', async (c) => {
  const userId = c.req.param('id');
  const err = forbidSelf(c, userId, 'sign out');
  if (err) return c.json({ error: err }, 400);
  await auth.api.revokeUserSessions({ body: { userId }, headers: c.req.raw.headers });
  return c.json({ ok: true });
});

/** Permanently deletes the account and everything it owns (spaces, collections, bookmarks, orgs). */
adminRoutes.delete('/users/:id', async (c) => {
  const userId = c.req.param('id');
  const err = forbidSelf(c, userId, 'delete');
  if (err) return c.json({ error: err }, 400);
  await auth.api.removeUser({ body: { userId }, headers: c.req.raw.headers });
  return c.body(null, 204);
});

const createInviteSchema = z.object({
  role: roleSchema.default('user'),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresInDays: z.number().min(1 / 24).max(365).default(7),
  email: z.string().email().optional(),
});

adminRoutes.post('/invites', zValidator('json', createInviteSchema), async (c) => {
  const { role, maxUses, expiresInDays, email } = c.req.valid('json');
  if (email && !getEnv().RESEND_API_KEY) {
    return c.json({ error: 'Email invites need RESEND_API_KEY; create a link invite instead' }, 400);
  }
  const result = (await auth.api.createInvite({
    body: { role, maxUses, email, expiresIn: Math.round(expiresInDays * DAY_MS / 1000), senderResponse: 'token' },
    headers: c.req.raw.headers,
  })) as { message?: string };

  const db = getDb();
  // better-invite only returns the token for link invites; email invites are found by sender + recipient.
  const [invite] = email
    ? await db
        .select()
        .from(invites)
        .where(and(eq(invites.createdByUserId, c.get('userId')), arrayContains(invites.emails, [email])))
        .orderBy(desc(invites.createdAt))
        .limit(1)
    : await db.select().from(invites).where(eq(invites.token, result.message ?? '')).limit(1);
  if (!invite) return c.json({ error: 'Invite was not created' }, 500);

  return c.json(
    {
      invite: {
        code: invite.token,
        url: inviteLandingUrl(invite.token),
        role: invite.role,
        maxUses: invite.maxUses,
        uses: 0,
        expiresAt: invite.expiresAt,
        emails: inviteEmails(invite),
        status: invite.status,
        createdAt: invite.createdAt,
      },
      emailed: Boolean(email),
    },
    201,
  );
});

adminRoutes.get('/invites', async (c) => {
  const db = getDb();
  const rows = await db
    .select({
      invite: invites,
      creatorEmail: users.email,
      uses: sql<number>`(select count(*)::int from ${inviteUses} where ${inviteUses.inviteId} = ${invites.id})`,
    })
    .from(invites)
    .leftJoin(users, eq(invites.createdByUserId, users.id))
    .orderBy(desc(invites.createdAt))
    .limit(200);
  const now = new Date();
  return c.json({
    invites: rows.map(({ invite, creatorEmail, uses }) => ({
      code: invite.token,
      url: inviteLandingUrl(invite.token),
      role: invite.role,
      maxUses: invite.infinityMaxUses ? null : invite.maxUses,
      uses,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      createdBy: creatorEmail,
      emails: inviteEmails(invite),
      status:
        invite.status !== 'pending'
          ? invite.status
          : invite.expiresAt <= now
            ? 'expired'
            : !invite.infinityMaxUses && uses >= invite.maxUses
              ? 'used'
              : 'pending',
    })),
  });
});

/** Revoke an unused invite. Invites created by other admins can be revoked too. */
adminRoutes.delete('/invites/:code', async (c) => {
  const db = getDb();
  const [invite] = await db.select().from(invites).where(eq(invites.token, c.req.param('code')));
  if (!invite) return c.json({ error: 'Invite not found' }, 404);
  const uses = await countInviteUses(invite.id);
  await db.update(invites).set({ status: uses > 0 ? 'used' : 'canceled' }).where(eq(invites.id, invite.id));
  return c.body(null, 204);
});
