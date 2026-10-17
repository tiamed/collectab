import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { admin, bearer } from 'better-auth/plugins';
import { defaultAc, defaultRoles } from 'better-auth/plugins/admin/access';
import { invite } from 'better-invite';
import bcrypt from 'bcrypt';
import { getDb } from '../database/client.js';
import * as dbSchema from '../database/schema.js';
import { getEnv } from '../config/env.js';
import { trustedOrigins } from './origins.js';
import { inviteLandingUrl, isAdmin } from './roles.js';

const SALT_ROUNDS = 12;

// Existing users were hashed with bcrypt(12); better-auth defaults to scrypt,
// so override to keep old hashes valid and stay consistent.
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  try {
    return await bcrypt.compare(data.password, data.hash);
  } catch {
    return false;
  }
}

const env = getEnv();
const db = getDb();

/** Fire-and-forget so auth responses don't wait on (or fail with) the mail provider. */
function sendEmail(to: string, subject: string, html: string) {
  void (async () => {
    const { Resend } = await import('resend');
    const resend = new Resend(getEnv().RESEND_API_KEY!);
    const { error } = await resend.emails.send({
      from: getEnv().RESEND_FROM_EMAIL || 'Collectab <noreply@collectab.app>',
      to,
      subject,
      html,
    });
    if (error) console.error(`[email] failed to send "${subject}": ${error.message}`);
  })().catch((err) => console.error(`[email] failed to send "${subject}":`, err));
}

/** Set by the HTTP layer from the socket/proxy; see clientIpFor() in app.ts. */
export const CLIENT_IP_HEADER = 'x-collectab-client-ip';

const authOptions = {
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: trustedOrigins(env),
  session: {
    expiresIn: Math.round(env.SESSION_EXPIRES_DAYS * 24 * 60 * 60),
    updateAge: Math.round(env.SESSION_UPDATE_AGE_HOURS * 60 * 60),
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema: dbSchema,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    disableSignUp: env.INVITE_MODE === 'invite-only',
    password: { hash: hashPassword, verify: verifyPassword },
    sendResetPassword: async ({ user, url }) => {
      if (getEnv().RESEND_API_KEY) {
        sendEmail(user.email, 'Reset your Collectab password', `Click <a href="${url}">here</a> to reset your password.`);
      } else if (env.NODE_ENV !== 'production') {
        console.log(`[password-reset] ${user.email}: ${url}`);
      } else {
        console.warn('[password-reset] requested but RESEND_API_KEY is not configured');
      }
    },
  },
  socialProviders: env.OAUTH_GOOGLE_CLIENT_ID
    ? {
        google: {
          clientId: env.OAUTH_GOOGLE_CLIENT_ID,
          clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET,
        },
      }
    : {},
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db.insert(dbSchema.spaces).values({
            ownerId: user.id,
            name: 'My Space',
            icon: '💼',
            orderIndex: 0,
          });
        },
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: env.RATE_LIMIT_WINDOW_SECONDS,
    max: env.RATE_LIMIT_MAX,
  },
  advanced: {
    // Cookies only carry the short-lived OAuth state/session inside the Google
    // sign-in window (same site as this server); the extension itself uses bearer tokens.
    useSecureCookies: env.BETTER_AUTH_URL.startsWith('https://'),
    defaultCookieAttributes: {
      sameSite: 'lax',
      httpOnly: true,
    },
    ipAddress: {
      ipAddressHeaders: [CLIENT_IP_HEADER],
    },
    database: {
      // Existing tables use UUID primary keys; better-auth defaults to
      // random alphanumeric IDs which Postgres rejects for UUID columns.
      generateId: 'uuid',
    },
  },
  plugins: [
    admin({
      defaultRole: env.DEFAULT_ROLE,
      adminUserIds: env.ADMIN_USER_IDS,
      roles: {
        guest: defaultAc.newRole({ user: [], session: [] }),
        ...defaultRoles,
      },
    }),
    bearer(),
    invite({
      defaultSenderResponse: 'token',
      invitationTokenExpiresIn: 7 * 24 * 60 * 60,
      // The plugin defaults to letting *any* signed-in user mint invites,
      // including role=admin ones they can then redeem themselves.
      canCreateInvite: ({ inviterUser }) => isAdmin(inviterUser as { id: string; role?: string | null }),
      sendUserInvitation: env.RESEND_API_KEY
        ? async ({ email, token }) => {
            const url = inviteLandingUrl(token);
            sendEmail(
              email,
              'You are invited to Collectab',
              `You have been invited to Collectab. Open <a href="${url}">${url}</a> for your invite code and setup steps.`,
            );
          }
        : undefined,
    }),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth(authOptions);

export type AppAuth = typeof auth;
