import { beforeEach, describe, expect, it, vi } from 'vitest';

type Store = Record<string, unknown>;
type ChangeListener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void;

function installBrowserMock(store: Store) {
  const listeners = new Set<ChangeListener>();
  const local = {
    get: async (keys: string | string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) changes[k] = { oldValue: store[k], newValue: v };
      Object.assign(store, items);
      for (const cb of listeners) cb(changes, 'local');
    },
    remove: async (keys: string | string[]) => {
      const changes: Record<string, { newValue?: unknown; oldValue?: unknown }> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in store) changes[k] = { oldValue: store[k] };
        delete store[k];
      }
      for (const cb of listeners) cb(changes, 'local');
    },
  };
  const storage = {
    local,
    onChanged: {
      addListener: (cb: ChangeListener) => listeners.add(cb),
      removeListener: (cb: ChangeListener) => listeners.delete(cb),
    },
  };
  vi.stubGlobal('browser', { storage });
  vi.stubGlobal('chrome', { storage });
  /** Simulate a write from another extension context (popup/newtab). */
  return (items: Record<string, unknown>) => {
    Object.assign(store, items);
    const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
    for (const cb of listeners) cb(changes, 'local');
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('extension auth client', () => {
  let store: Store;
  let externalWrite: (items: Record<string, unknown>) => void;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    store = { api_base_url: 'https://api.example.com/api' };
    externalWrite = installBrowserMock(store);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  async function loadApi() {
    const api = await import('@/lib/api');
    await api.loadApiBase();
    return api;
  }

  it('never calls the removed /auth/refresh endpoint and drops the token on the first 401', async () => {
    store.access_token = 'stale';
    const api = await loadApi();
    fetchMock.mockResolvedValue(json({ error: 'Invalid or expired session' }, 401));

    const results = await Promise.allSettled([api.getSpaces(), api.getOrganizations(), api.getCollections('s1')]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/auth/refresh'))).toBe(false);
    expect(api.isLoggedIn()).toBe(false);
    expect(store.access_token).toBeUndefined();

    fetchMock.mockClear();
    await expect(api.getSpaces()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the token on network errors and non-auth failures', async () => {
    store.access_token = 'good';
    const api = await loadApi();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.getSpaces()).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(json({ error: 'Forbidden' }, 403));
    await expect(api.getSpaces()).rejects.toMatchObject({ status: 403 });
    expect(api.isLoggedIn()).toBe(true);
  });

  it('purges tokens left by the old JWT client without a network round-trip', async () => {
    store.access_token = 'old-jwt';
    store.refresh_token = 'old-refresh';
    const api = await loadApi();
    expect(api.isLoggedIn()).toBe(false);
    expect(store.refresh_token).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores the Better Auth session token from sign-in and sends it as a bearer', async () => {
    const api = await loadApi();
    fetchMock.mockResolvedValueOnce(json({ token: 'sess', user: { id: 'u1', email: 'a@b.c', name: 'A' } }));
    await api.login('a@b.c', 'password123');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/api/auth/sign-in/email');
    expect(store.access_token).toBe('sess');

    fetchMock.mockResolvedValueOnce(json({ spaces: [] }));
    await api.getSpaces();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer sess');
  });

  it('notifies subscribers when another context signs in or out', async () => {
    const api = await loadApi();
    const events: boolean[] = [];
    api.subscribeSession((loggedIn) => events.push(loggedIn));

    externalWrite({ access_token: 'from-popup' });
    expect(api.getToken()).toBe('from-popup');
    externalWrite({ access_token: undefined });
    expect(api.isLoggedIn()).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it('sends the invite code with sign-up only when one is given', async () => {
    const api = await loadApi();
    const signedUp = () => json({ token: 'sess', user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'user' } });
    fetchMock.mockResolvedValueOnce(signedUp()).mockResolvedValueOnce(signedUp());
    await api.register('a@b.c', 'password123', 'A', '  abc123 ');
    await api.register('a@b.c', 'password123', 'A', '');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).inviteCode).toBe('abc123');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('inviteCode');
  });

  it('accepts a pasted invite link wherever a code is expected', async () => {
    store.access_token = 'sess';
    const api = await loadApi();
    expect(api.parseInviteCode('https://collectab.example.com/invite/AbC123?x=1')).toBe('AbC123');
    expect(api.parseInviteCode(' AbC123 ')).toBe('AbC123');

    fetchMock.mockResolvedValueOnce(json({ role: 'user' }));
    await api.redeemInvite('https://collectab.example.com/invite/AbC123');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/api/invites/redeem');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'AbC123' });
  });

  it('normalises server URLs to the /api base', async () => {
    const api = await loadApi();
    expect(api.normalizeApiBase('https://api.example.com')).toBe('https://api.example.com/api');
    expect(api.normalizeApiBase('https://api.example.com/api/')).toBe('https://api.example.com/api');
    await api.setApiBase('https://other.example.com/');
    expect(api.getApiBase()).toBe('https://other.example.com/api');
  });
});
