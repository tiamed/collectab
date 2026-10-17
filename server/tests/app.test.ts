import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession, signInSocial, handler, activateInvite, deleteUser, checkInvite } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInSocial: vi.fn(),
  handler: vi.fn(),
  activateInvite: vi.fn(),
  deleteUser: vi.fn(),
  checkInvite: vi.fn(),
}));

vi.mock('../src/auth/auth.js', () => ({
  CLIENT_IP_HEADER: 'x-collectab-client-ip',
  auth: {
    handler,
    api: { getSession, signInSocial, activateInvite },
    $context: Promise.resolve({
      internalAdapter: { deleteUser },
      authCookies: {
        sessionToken: { name: '__Secure-better-auth.session_token', attributes: { secure: true } },
        sessionData: { name: '__Secure-better-auth.session_data' },
        dontRememberToken: { name: '__Secure-better-auth.dont_remember' },
      },
    }),
  },
}));

vi.mock('../src/database/client.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: 'u1', email: 'u1@example.com', name: 'U1', avatarUrl: null, role: 'guest' }]),
      }),
    }),
  }),
  getPool: () => ({}),
}));

vi.mock('../src/auth/invites.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/auth/invites.js')>()),
  checkInvite,
}));

process.env.OAUTH_GOOGLE_CLIENT_ID = 'test-client-id';
process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'test-client-secret';

const { createApp, clientIpFor } = await import('../src/app.js');
const { signUpPermit } = await import('../src/auth/invites.js');
const { getEnv } = await import('../src/config/env.js');

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/oauth';

describe('app wiring', () => {
  const app = createApp();

  beforeEach(() => {
    getSession.mockReset();
    signInSocial.mockReset();
    handler.mockReset();
    handler.mockResolvedValue(new Response('{}', { status: 200 }));
    activateInvite.mockReset();
    deleteUser.mockReset();
    checkInvite.mockReset();
  });

  it('keeps non-admins out of /api/admin', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com', role: 'user' }, session: {} });
    const res = await app.request('/api/admin/stats', { headers: { Authorization: 'Bearer t' } });
    expect(res.status).toBe(403);
  });

  it('reports isAdmin on /api/auth/me', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com', role: 'guest' }, session: {} });
    const res = await app.request('/api/auth/me', { headers: { Authorization: 'Bearer t' } });
    expect((await res.json()).user.isAdmin).toBe(false);
  });

  describe('sign-up', () => {
    const signUp = (body: Record<string, unknown>, path = '/api/auth/sign-up/email') =>
      app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { Origin: EXT, 'Content-Type': 'application/json' } });
    const account = { email: 'new@example.com', password: 'password123', name: 'N' };
    const signedUp = () =>
      new Response(JSON.stringify({ token: 'tok', user: { id: 'u9', role: 'guest' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'set-auth-token': 'tok' },
      });

    it('creates accounts under the sign-up permit in open mode', async () => {
      let permitted: unknown;
      handler.mockImplementation(async () => {
        permitted = signUpPermit.getStore()?.allowed;
        return signedUp();
      });
      const res = await signUp(account);
      expect(res.status).toBe(200);
      expect(permitted).toBe(true);
      expect(checkInvite).not.toHaveBeenCalled();
    });

    it('rejects a bad invite code before creating the account', async () => {
      checkInvite.mockResolvedValue({ ok: false, code: 'INVITE_EXPIRED', message: 'This invite has expired' });
      const res = await signUp({ ...account, inviteCode: 'old' });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVITE_EXPIRED');
      expect(handler).not.toHaveBeenCalled();
    });

    it('applies the invite after sign-up and strips the code from the Better Auth body', async () => {
      checkInvite.mockResolvedValue({ ok: true, invite: { role: 'user' }, uses: 0 });
      handler.mockResolvedValue(signedUp());
      const res = await signUp({ ...account, inviteCode: 'abc' });
      expect(res.status).toBe(200);
      expect((await res.json()).user.role).toBe('user');
      expect(res.headers.get('set-auth-token')).toBe('tok');
      expect(JSON.parse(await (handler.mock.calls[0][0] as Request).text())).toEqual(account);
      const call = activateInvite.mock.calls[0][0];
      expect(call.body).toEqual({ token: 'abc' });
      expect(call.headers.get('authorization')).toBe('Bearer tok');
    });

    it('cannot be bypassed by respelling the path', async () => {
      checkInvite.mockResolvedValue({ ok: false, code: 'INVALID_INVITE', message: 'nope' });
      for (const path of ['/api/auth/sign-up/email/', '/api/auth//sign-up/email', '/api/auth/Sign-Up/Email']) {
        const res = await signUp({ ...account, inviteCode: 'x' }, path);
        expect(res.status, path).toBe(400);
      }
      expect(handler).not.toHaveBeenCalled();
    });

    describe('invite-only mode', () => {
      beforeEach(() => {
        getEnv().INVITE_MODE = 'invite-only';
        return () => {
          getEnv().INVITE_MODE = 'open';
        };
      });

      it('requires an invite code', async () => {
        const res = await signUp(account);
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('INVITE_REQUIRED');
        expect(handler).not.toHaveBeenCalled();
      });

      it('deletes the account if the invite was used up in the meantime', async () => {
        checkInvite.mockResolvedValue({ ok: true, invite: { role: 'user' }, uses: 0 });
        handler.mockResolvedValue(signedUp());
        activateInvite.mockRejectedValue(new Error('used up'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await signUp({ ...account, inviteCode: 'abc' });
        expect(res.status).toBe(400);
        expect(deleteUser).toHaveBeenCalledWith('u9');
      });
    });
  });

  it('routes GET /api/auth/me to our handler, not the Better Auth catch-all', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com', role: 'guest' }, session: {} });
    const res = await app.request('/api/auth/me', { headers: { Authorization: 'Bearer t' } });
    expect(res.status).toBe(200);
    expect((await res.json()).user.id).toBe('u1');
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns JSON errors for expired sessions', async () => {
    getSession.mockResolvedValue(null);
    const res = await app.request('/api/auth/me', { headers: { Authorization: 'Bearer stale' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid or expired session' });
  });

  it('answers legacy /api/auth/refresh with a terminal 401', async () => {
    const res = await app.request('/api/auth/refresh', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards other /api/auth/* calls to Better Auth with a non-spoofable client IP header', async () => {
    await app.request(
      '/api/auth/sign-in/email',
      { method: 'POST', body: '{"email":"a@b.c"}', headers: { 'x-collectab-client-ip': '6.6.6.6', Origin: EXT } },
      { incoming: { socket: { remoteAddress: '203.0.113.7' } } },
    );
    const forwarded = handler.mock.calls[0][0] as Request;
    expect(forwarded.headers.get('x-collectab-client-ip')).toBe('203.0.113.7');
    expect(forwarded.headers.get('origin')).toBe(EXT);
    expect(await forwarded.text()).toBe('{"email":"a@b.c"}');
  });

  it('does not expose better-invite endpoints over HTTP', async () => {
    for (const path of ['/api/auth/invite/create', '/api/auth/invite/activate', '/api/auth/invite/list']) {
      const res = await app.request(path, { method: 'POST', body: '{"role":"admin"}', headers: { Authorization: 'Bearer t' } });
      expect(res.status, path).toBe(404);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('exposes public auth config', async () => {
    const res = await app.request('/api/auth-config');
    expect(await res.json()).toEqual({ inviteMode: 'open', google: true });
  });

  it('answers CORS preflight for the extension but not for arbitrary sites', async () => {
    const preflight = (origin: string) =>
      app.request('/api/spaces', {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      });
    expect((await preflight(EXT)).headers.get('access-control-allow-origin')).toBe(EXT);
    expect((await preflight('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves a privacy policy page', async () => {
    const res = await app.request('/privacy');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Collectab Privacy Policy');
  });

  describe('Google OAuth bridge', () => {
    it('rejects redirect URIs outside the extension allow-list', async () => {
      const res = await app.request(`/api/oauth/google/start?redirect_uri=${encodeURIComponent('https://evil.example/')}`);
      expect(res.status).toBe(400);
      expect(signInSocial).not.toHaveBeenCalled();
    });

    it('starts the flow with a same-origin callback and forwards the state cookie', async () => {
      signInSocial.mockResolvedValue(
        new Response(JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', redirect: true }), {
          status: 200,
          headers: { 'Set-Cookie': 'better-auth.state=abc; Path=/; HttpOnly' },
        }),
      );
      const res = await app.request(`/api/oauth/google/start?redirect_uri=${encodeURIComponent(REDIRECT)}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
      expect(res.headers.get('set-cookie')).toContain('better-auth.state=abc');
      const body = signInSocial.mock.calls[0][0].body;
      expect(body.callbackURL).toBe(`/api/oauth/complete?redirect_uri=${encodeURIComponent(REDIRECT)}`);
    });

    it('hands the session token to the extension in the URL fragment and clears cookies', async () => {
      getSession.mockResolvedValue({ user: { id: 'u1' }, session: { token: 'sess-token' } });
      const res = await app.request(`/api/oauth/complete?redirect_uri=${encodeURIComponent(REDIRECT)}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${REDIRECT}#token=sess-token`);
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c) => c.startsWith('__Secure-better-auth.session_token=;') && c.includes('Max-Age=0'))).toBe(true);
    });

    it('propagates OAuth errors without a token', async () => {
      const res = await app.request(`/api/oauth/complete?redirect_uri=${encodeURIComponent(REDIRECT)}&error=access_denied`);
      expect(res.headers.get('location')).toBe(`${REDIRECT}#error=access_denied`);
      expect(getSession).not.toHaveBeenCalled();
    });
  });
});

describe('clientIpFor', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('uses the TCP peer unless TRUST_PROXY is on', () => {
    expect(clientIpFor(h({ 'x-real-ip': '1.1.1.1' }), '10.0.0.1', false)).toBe('10.0.0.1');
  });

  it('prefers X-Real-IP, then the last X-Forwarded-For hop, behind a proxy', () => {
    expect(clientIpFor(h({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 2.2.2.2' }), '10.0.0.1', true)).toBe('1.1.1.1');
    expect(clientIpFor(h({ 'x-forwarded-for': 'spoofed, 2.2.2.2' }), '10.0.0.1', true)).toBe('2.2.2.2');
    expect(clientIpFor(h({}), '10.0.0.1', true)).toBe('10.0.0.1');
    expect(clientIpFor(h({ 'x-real-ip': '9.9.9.12345' }), '10.0.0.1', true)).toBe('10.0.0.1');
  });
});
