import { getEnv } from '../config/env.js';

export const ROLES = ['guest', 'user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Public page that shows an invite code and how to redeem it in the extension. */
export function inviteLandingUrl(code: string): string {
  return `${getEnv().BETTER_AUTH_URL}/invite/${encodeURIComponent(code)}`;
}

export function isAdmin(user: { id: string; role?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || getEnv().ADMIN_USER_IDS.includes(user.id);
}
