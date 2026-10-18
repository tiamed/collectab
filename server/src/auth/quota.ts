import { getEnv } from '../config/env.js';

const DEFAULT_QUOTAS: Record<string, number | null> = {
  guest: 10,
  user: 500,
  admin: null,
};

/**
 * Returns the bookmark quota for a role, or null when unlimited.
 * Quotas are disabled entirely when DISABLE_QUOTAS is set.
 */
export function getQuotaForRole(role: string | null | undefined): number | null {
  const env = getEnv();
  if (env.DISABLE_QUOTAS) return null;

  const key = role ?? 'guest';
  if (env.ROLE_QUOTAS && env.ROLE_QUOTAS[key] !== undefined) {
    return env.ROLE_QUOTAS[key];
  }
  return key in DEFAULT_QUOTAS ? DEFAULT_QUOTAS[key] : DEFAULT_QUOTAS.guest;
}
