import type { Env } from '../config/env.js';

const CHROME_ID = /^[a-p]{32}$/;
const EXTENSION_SCHEMES = ['chrome-extension://', 'moz-extension://'];

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** `chrome-extension://<id>` / `moz-extension://<uuid>` origins accepted by this server. */
export function extensionOrigins(env: Pick<Env, 'EXTENSION_IDS'>): string[] {
  if (env.EXTENSION_IDS.length === 0) return [...EXTENSION_SCHEMES];
  return env.EXTENSION_IDS.map((id) => {
    if (CHROME_ID.test(id)) return `chrome-extension://${id}`;
    return EXTENSION_SCHEMES.includes(id) ? id : id.replace(/\/+$/, '');
  });
}

/**
 * Better Auth `trustedOrigins`. Non-http entries are prefix-matched by Better
 * Auth, so a bare `chrome-extension://` trusts every extension. That is safe
 * here because the extension authenticates with bearer tokens, not cookies:
 * the Origin check is CSRF protection, and an extension cannot ride on a
 * cookie session it doesn't have.
 */
export function trustedOrigins(env: Pick<Env, 'BETTER_AUTH_URL' | 'TRUSTED_ORIGINS' | 'EXTENSION_IDS'>): string[] {
  const own = originOf(env.BETTER_AUTH_URL);
  return [...new Set([...(own ? [own] : []), ...env.TRUSTED_ORIGINS, ...extensionOrigins(env)])];
}

export function isExtensionOrigin(origin: string, env: Pick<Env, 'EXTENSION_IDS'>): boolean {
  return extensionOrigins(env).some((allowed) =>
    allowed.endsWith('://') ? origin.startsWith(allowed) && origin.length > allowed.length : origin === allowed,
  );
}

/** CORS decision: returns the origin to echo, or null to omit CORS headers. */
export function corsOrigin(
  origin: string | undefined,
  env: Pick<Env, 'BETTER_AUTH_URL' | 'TRUSTED_ORIGINS' | 'EXTENSION_IDS' | 'CORS_ORIGIN'>,
): string | null {
  if (env.CORS_ORIGIN.includes('*')) return '*';
  if (!origin) return null;
  if (isExtensionOrigin(origin, env)) return origin;
  const own = originOf(env.BETTER_AUTH_URL);
  if (origin === own || env.TRUSTED_ORIGINS.includes(origin) || env.CORS_ORIGIN.includes(origin)) return origin;
  return null;
}

/**
 * Where an OAuth flow may hand the session token back to: the redirect URL
 * Chrome (`https://<id>.chromiumapp.org/`) or Firefox
 * (`https://<hash>.extensions.allizom.org/`) intercepts for
 * `identity.launchWebAuthFlow`. Anything else would leak the token.
 */
export function isAllowedExtensionRedirect(redirectUri: string, env: Pick<Env, 'EXTENSION_IDS'>): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;

  const chrome = url.hostname.match(/^([a-p]{32})\.chromiumapp\.org$/);
  if (chrome) {
    const ids = env.EXTENSION_IDS.filter((id) => CHROME_ID.test(id));
    const allowAny = env.EXTENSION_IDS.length === 0 || env.EXTENSION_IDS.includes('chrome-extension://');
    return allowAny || ids.includes(chrome[1]);
  }
  if (/^[a-f0-9]{40}\.extensions\.allizom\.org$/.test(url.hostname)) {
    return env.EXTENSION_IDS.length === 0 || env.EXTENSION_IDS.includes('moz-extension://');
  }
  return false;
}
