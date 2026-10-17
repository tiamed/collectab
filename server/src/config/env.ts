import { z } from 'zod';

const DEV_SECRET = 'dev-better-auth-secret-change-in-production-32chars';

const csv = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean));

const bool = (fallback: 'true' | 'false') =>
  z
    .string()
    .default(fallback)
    .transform((s) => s === 'true' || s === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/collectab'),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters')
    .default(DEV_SECRET),
  /** Public origin of this server, e.g. https://api.example.com (no /api suffix). */
  BETTER_AUTH_URL: z
    .string()
    .default('http://localhost:3001')
    .transform((s) => s.trim().replace(/\/+$/, '').replace(/\/api(\/auth)?$/, '')),
  /** Extra browser origins allowed for CORS. `*` allows any origin (bearer auth only, no cookies). */
  CORS_ORIGIN: csv,
  /** Extra origins trusted by Better Auth (sign-in/up Origin check, callback URLs). */
  TRUSTED_ORIGINS: csv,
  /**
   * Chrome extension IDs (or full `chrome-extension://…` / `moz-extension://…` origins)
   * allowed to sign in. Empty = any extension origin (fine for self-hosting, set it for public servers).
   */
  EXTENSION_IDS: csv,
  /** Sliding session lifetime: a session unused for this many days expires. */
  SESSION_EXPIRES_DAYS: z.coerce.number().positive().default(30),
  /** How often (hours) an active session's expiry is pushed forward. */
  SESSION_UPDATE_AGE_HOURS: z.coerce.number().positive().default(24),
  /**
   * Set when running behind a reverse proxy (nginx/Caddy) that sets X-Real-IP or
   * appends to X-Forwarded-For. Without it the TCP peer address is used.
   */
  TRUST_PROXY: bool('false'),
  DEFAULT_ROLE: z.enum(['guest', 'user', 'admin']).default('guest'),
  ADMIN_USER_IDS: csv,
  ROLE_QUOTAS: z
    .string()
    .default('')
    .transform((s) => {
      if (!s.trim()) return undefined;
      const quotas: Record<string, number | null> = {};
      for (const pair of s.split(',')) {
        const [role, value] = pair.split('=').map((x) => x.trim());
        const lowered = value?.toLowerCase();
        if (role && (lowered === 'unlimited' || lowered === 'inf' || value === '-1')) {
          quotas[role] = null;
        } else {
          const num = Number(value);
          if (role && !Number.isNaN(num)) quotas[role] = num;
        }
      }
      return Object.keys(quotas).length > 0 ? quotas : undefined;
    }),
  DISABLE_QUOTAS: bool('false'),
  INVITE_MODE: z.enum(['open', 'invite-only']).default('open'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  /** Chrome Web Store (or other) install link shown on invite pages. */
  EXTENSION_INSTALL_URL: z.string().optional(),
  /** Shown on the /privacy page. */
  PRIVACY_CONTACT_EMAIL: z.string().optional(),
  PRIVACY_OPERATOR_NAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let env: Env | null = null;

/** Problems that make a production deployment unsafe or broken. */
export function productionConfigErrors(e: Env): string[] {
  if (e.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  if (e.BETTER_AUTH_SECRET === DEV_SECRET || /change[-_]?this/i.test(e.BETTER_AUTH_SECRET)) {
    errors.push('BETTER_AUTH_SECRET is still the example value; generate one with `openssl rand -base64 32`.');
  }
  if (!/^https:\/\//.test(e.BETTER_AUTH_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(e.BETTER_AUTH_URL)) {
    errors.push(`BETTER_AUTH_URL must be the public https:// origin of this server (got "${e.BETTER_AUTH_URL}").`);
  }
  if (e.OAUTH_GOOGLE_CLIENT_ID && !e.OAUTH_GOOGLE_CLIENT_SECRET) {
    errors.push('OAUTH_GOOGLE_CLIENT_ID is set but OAUTH_GOOGLE_CLIENT_SECRET is empty.');
  }
  return errors;
}

export function getEnv(): Env {
  if (env) return env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', z.flattenError(result.error).fieldErrors);
    process.exit(1);
  }
  const errors = productionConfigErrors(result.data);
  if (errors.length > 0) {
    for (const msg of errors) console.error(`[config] ${msg}`);
    process.exit(1);
  }
  env = result.data;
  return env;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}
