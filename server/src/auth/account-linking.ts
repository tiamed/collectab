import type { BetterAuthOptions } from 'better-auth';
import { revokeUnprovenAccountAccess } from 'better-auth/db';

type AccountCreateBefore = NonNullable<
  NonNullable<NonNullable<NonNullable<BetterAuthOptions['databaseHooks']>['account']>['create']>['before']
>;

/**
 * Sign in with Google links to an existing account with the same email, as
 * long as Google reports that email as verified (Google isn't listed in
 * `trustedProviders`, so unverified Google emails still get `account_not_linked`).
 *
 * Email/password sign-up never verifies the address, so Better Auth's default
 * `requireLocalEmailVerified: true` would refuse every such link. It is turned
 * off here and replaced by `claimUnprovenAccount`, which keeps the protection
 * that default exists for.
 */
export const accountLinking = {
  enabled: true,
  requireLocalEmailVerified: false,
} satisfies NonNullable<BetterAuthOptions['account']>['accountLinking'];

/**
 * `account.create.before` hook. When a provider account is about to be linked
 * to an existing user whose email was never verified, whoever set that
 * user's password or opened its sessions never proved they own the mailbox.
 * Someone could have registered the victim's address in advance. The verified
 * owner inherits none of it: Better Auth's own `revokeUnprovenAccountAccess`
 * (used by magic-link and email-OTP for the same situation) deletes the prior
 * logins and sessions and marks the email verified. Bookmarks and spaces stay.
 * Users who still want a password can reset it, or an admin can set one.
 */
export const claimUnprovenAccount: AccountCreateBefore = async (account, ctx) => {
  if (!ctx || account.providerId === 'credential') return;
  const adapter = ctx.context.internalAdapter;
  const user = await adapter.findUserById(account.userId);
  if (!user || user.emailVerified) return;
  // A brand-new OAuth user has no prior logins to strip.
  if ((await adapter.findAccounts(account.userId)).length === 0) return;
  await revokeUnprovenAccountAccess(ctx, account.userId);
};
