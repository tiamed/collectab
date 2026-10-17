import { AsyncLocalStorage } from 'node:async_hooks';
import { and, count, eq } from 'drizzle-orm';
import { getDb } from '../database/client.js';
import { invites, inviteUses } from '../database/schema.js';

export type InviteRow = typeof invites.$inferSelect;

export type InviteCheck =
  | { ok: true; invite: InviteRow; uses: number }
  | { ok: false; code: 'INVALID_INVITE' | 'INVITE_EXPIRED' | 'INVITE_USED_UP' | 'INVITE_EMAIL_MISMATCH'; message: string };

export function inviteEmails(invite: Pick<InviteRow, 'email' | 'emails'>): string[] {
  return [...(invite.emails ?? []), ...(invite.email ? [invite.email] : [])].map((e) => e.toLowerCase());
}

export async function countInviteUses(inviteId: string): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(inviteUses).where(eq(inviteUses.inviteId, inviteId));
  return row?.n ?? 0;
}

/** Mirrors better-invite's own acceptance rules so we can reject before an account is created. */
export async function checkInvite(
  code: string,
  email?: string,
  { ignoreEmail = false, now = new Date() }: { ignoreEmail?: boolean; now?: Date } = {},
): Promise<InviteCheck> {
  const [invite] = await getDb()
    .select()
    .from(invites)
    .where(and(eq(invites.token, code), eq(invites.status, 'pending')));
  if (!invite) return { ok: false, code: 'INVALID_INVITE', message: 'This invite code is not valid' };
  if (invite.expiresAt <= now) return { ok: false, code: 'INVITE_EXPIRED', message: 'This invite has expired' };
  const uses = await countInviteUses(invite.id);
  if (!invite.infinityMaxUses && uses >= invite.maxUses) {
    return { ok: false, code: 'INVITE_USED_UP', message: 'This invite has already been used' };
  }
  const allowed = inviteEmails(invite);
  if (!ignoreEmail && allowed.length > 0 && (!email || !allowed.includes(email.trim().toLowerCase()))) {
    return { ok: false, code: 'INVITE_EMAIL_MISMATCH', message: 'This invite is for a different email address' };
  }
  return { ok: true, invite, uses };
}

/**
 * Set while handling a sign-up whose invite code (or open registration) was
 * already checked. In invite-only mode the user.create hook refuses to create
 * accounts outside of it, which covers every other path Better Auth could
 * create a user through (social callbacks, path-normalisation tricks, …).
 */
export const signUpPermit = new AsyncLocalStorage<{ allowed: true }>();
