import { isIP } from 'node:net';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth, CLIENT_IP_HEADER } from './auth/auth.js';
import { corsOrigin, isAllowedExtensionRedirect } from './auth/origins.js';
import { spaceRoutes } from './api/routes/spaces.js';
import { collectionRoutes } from './api/routes/collections.js';
import { bookmarkRoutes } from './api/routes/bookmarks.js';
import { searchRoutes } from './api/routes/search.js';
import { importRoutes } from './api/routes/import.js';
import { memberRoutes } from './api/routes/members.js';
import { orgRoutes } from './api/routes/organizations.js';
import { meRoutes } from './api/routes/me.js';
import { adminRoutes } from './api/routes/admin.js';
import { privacyPolicyHtml } from './api/routes/privacy.js';
import { errorHandler } from './api/middleware/error-handler.js';
import { getEnv } from './config/env.js';

type NodeBindings = { incoming?: { socket?: { remoteAddress?: string } } };

/**
 * Better Auth keys its rate limiter by client IP read from a header. Behind a
 * proxy that is X-Real-IP / the last X-Forwarded-For hop (the one our proxy
 * appended); without one it is the TCP peer. Clients can't spoof it because
 * any incoming copy of the header is overwritten.
 */
export function clientIpFor(headers: Headers, remoteAddress: string | undefined, trustProxy: boolean): string | null {
  if (trustProxy) {
    const real = headers.get('x-real-ip')?.trim();
    if (real && isIP(real)) return real;
    const hops = headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean);
    const last = hops?.[hops.length - 1];
    if (last && isIP(last)) return last;
  }
  return remoteAddress ?? null;
}

async function withClientIp(c: Context, trustProxy: boolean): Promise<Request> {
  const req = c.req.raw;
  const headers = new Headers(req.headers);
  headers.delete(CLIENT_IP_HEADER);
  const remote = (c.env as NodeBindings | undefined)?.incoming?.socket?.remoteAddress;
  const ip = clientIpFor(req.headers, remote, trustProxy);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(req.url, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
  });
}

async function expireAuthCookies(res: Response) {
  const ctx = await auth.$context;
  const secure = ctx.authCookies.sessionToken.attributes.secure ? '; Secure' : '';
  const names = [ctx.authCookies.sessionToken.name, ctx.authCookies.sessionData.name, ctx.authCookies.dontRememberToken.name];
  for (const name of names) {
    res.headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  }
}

export function createApp() {
  const env = getEnv();
  const app = new Hono();
  app.onError(errorHandler);
  const googleEnabled = Boolean(env.OAUTH_GOOGLE_CLIENT_ID && env.OAUTH_GOOGLE_CLIENT_SECRET);

  if (env.NODE_ENV !== 'test') app.use('*', logger());
  app.use(
    '*',
    cors({
      origin: (origin) => corsOrigin(origin, env),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['set-auth-token'],
      maxAge: 86400,
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/privacy', (c) => c.html(privacyPolicyHtml(env)));

  app.get('/api/auth-config', (c) =>
    c.json({ inviteMode: env.INVITE_MODE, google: googleEnabled }),
  );

  // Pre-Better-Auth extension builds call this on every 401. Answer with a
  // definitive 401 so they drop their stored tokens and stop retrying.
  app.post('/api/auth/refresh', (c) =>
    c.json({ error: 'Token refresh is no longer supported; please sign in again' }, 401),
  );

  // Must be registered before the Better Auth catch-all below.
  app.route('/api/auth/me', meRoutes);

  app.get('/api/oauth/google/start', async (c) => {
    if (!googleEnabled) return c.text('Google sign-in is not enabled on this server', 404);
    const redirectUri = c.req.query('redirect_uri') ?? '';
    if (!isAllowedExtensionRedirect(redirectUri, env)) return c.text('Invalid redirect_uri', 400);

    const done = `/api/oauth/complete?redirect_uri=${encodeURIComponent(redirectUri)}`;
    const res = await auth.api.signInSocial({
      body: { provider: 'google', callbackURL: done, errorCallbackURL: done },
      headers: c.req.raw.headers,
      asResponse: true,
    });
    const data = (await res.clone().json().catch(() => null)) as { url?: string } | null;
    if (!res.ok || !data?.url) return c.text('Could not start Google sign-in', 502);

    const out = new Response(null, { status: 302, headers: { Location: data.url, 'Cache-Control': 'no-store' } });
    for (const cookie of res.headers.getSetCookie()) out.headers.append('Set-Cookie', cookie);
    return out;
  });

  app.get('/api/oauth/complete', async (c) => {
    const redirectUri = c.req.query('redirect_uri') ?? '';
    if (!isAllowedExtensionRedirect(redirectUri, env)) return c.text('Invalid redirect_uri', 400);

    const target = new URL(redirectUri);
    const error = c.req.query('error');
    if (error) {
      target.hash = `error=${encodeURIComponent(error)}`;
    } else {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      target.hash = session
        ? `token=${encodeURIComponent(session.session.token)}`
        : 'error=no_session';
    }

    const res = new Response(null, {
      status: 302,
      headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
    // The extension owns the session via its bearer token now; don't leave a
    // second copy behind as a cookie in the user's browser profile.
    await expireAuthCookies(res);
    return res;
  });

  app.on(['POST', 'GET'], '/api/auth/*', async (c) => auth.handler(await withClientIp(c, env.TRUST_PROXY)));

  app.route('/api/spaces', spaceRoutes);
  app.route('/api/collections', collectionRoutes);
  app.route('/api/bookmarks', bookmarkRoutes);
  app.route('/api/search', searchRoutes);
  app.route('/api/import', importRoutes);
  app.route('/api/members', memberRoutes);
  app.route('/api/orgs', orgRoutes);
  app.route('/api/admin', adminRoutes);

  return app;
}
