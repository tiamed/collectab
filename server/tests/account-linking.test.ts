import { describe, it, expect, beforeEach } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { bearer } from 'better-auth/plugins';
import { accountLinking, claimUnprovenAccount } from '../src/auth/account-linking.js';

const EMAIL = 'tiamedue@gmail.com';

type GoogleProfile = { email: string; emailVerified: boolean; sub?: string };

function createAuth(profile: () => GoogleProfile) {
  const db: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    secret: 'test-secret-test-secret-test-secret-1234',
    baseURL: 'http://localhost:3001',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    socialProviders: {
      google: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        verifyIdToken: async () => true,
        getUserInfo: async () => {
          const p = profile();
          const sub = p.sub ?? 'google-sub-1';
          return {
            user: { id: sub, email: p.email, emailVerified: p.emailVerified, name: 'Tia' },
            data: { sub, email: p.email, email_verified: p.emailVerified },
          };
        },
      },
    },
    account: { accountLinking },
    databaseHooks: { account: { create: { before: claimUnprovenAccount } } },
    rateLimit: { enabled: false },
    plugins: [bearer()],
  });
  return { auth, db };
}

const googleSignIn = (auth: ReturnType<typeof createAuth>['auth']) =>
  auth.api.signInSocial({ body: { provider: 'google', idToken: { token: 'id-token' } } }) as Promise<{
    token: string;
    user: { id: string; email: string };
  }>;

const authHeader = (token: string) => new Headers({ Authorization: `Bearer ${token}` });

describe('Google sign-in for an existing email/password account', () => {
  let profile: GoogleProfile;
  let auth: ReturnType<typeof createAuth>['auth'];
  let db: ReturnType<typeof createAuth>['db'];

  beforeEach(() => {
    profile = { email: EMAIL, emailVerified: true };
    ({ auth, db } = createAuth(() => profile));
  });

  it('links Google to the existing user instead of failing with account_not_linked', async () => {
    const signedUp = await auth.api.signUpEmail({ body: { email: EMAIL, password: 'password123', name: 'Tia' } });

    const res = await googleSignIn(auth);

    expect(res.user.id).toBe(signedUp.user.id);
    expect(db.user).toHaveLength(1);
    expect(db.account.map((a) => a.providerId)).toContain('google');
    expect(await auth.api.getSession({ headers: authHeader(res.token) })).toMatchObject({ user: { id: signedUp.user.id } });
    expect(db.user[0].emailVerified).toBe(true);
  });

  it('strips logins and sessions from before the email was proven', async () => {
    const signedUp = await auth.api.signUpEmail({ body: { email: EMAIL, password: 'password123', name: 'Tia' } });

    expect(await auth.api.getSession({ headers: authHeader(signedUp.token!) })).not.toBeNull();
    await googleSignIn(auth);

    expect(db.account.map((a) => a.providerId)).toEqual(['google']);
    expect(await auth.api.getSession({ headers: authHeader(signedUp.token!) })).toBeNull();
    await expect(auth.api.signInEmail({ body: { email: EMAIL, password: 'password123' } })).rejects.toThrow();
  });

  it('keeps the password of an account whose email is already verified', async () => {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: 'password123', name: 'Tia' } });
    db.user[0].emailVerified = true;

    await googleSignIn(auth);

    expect(db.account.map((a) => a.providerId).sort()).toEqual(['credential', 'google']);
    await expect(auth.api.signInEmail({ body: { email: EMAIL, password: 'password123' } })).resolves.toHaveProperty('token');
  });

  it('signs in again through the linked account on later Google logins', async () => {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: 'password123', name: 'Tia' } });
    const first = await googleSignIn(auth);
    const second = await googleSignIn(auth);
    expect(second.user.id).toBe(first.user.id);
    expect(db.account.filter((a) => a.providerId === 'google')).toHaveLength(1);
  });

  it('still refuses to link when Google has not verified the email', async () => {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: 'password123', name: 'Tia' } });
    profile = { email: EMAIL, emailVerified: false };

    await expect(googleSignIn(auth)).rejects.toThrow(/account not linked/);
    expect(db.account.map((a) => a.providerId)).toEqual(['credential']);
  });

  it('does not touch a brand-new Google user', async () => {
    const res = await googleSignIn(auth);
    expect(db.user).toHaveLength(1);
    expect(db.account.map((a) => a.providerId)).toEqual(['google']);
    expect(await auth.api.getSession({ headers: authHeader(res.token) })).not.toBeNull();
  });
});
