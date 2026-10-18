import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from '../src/api/middleware/auth.js';

const mockSession = vi.fn();

vi.mock('../src/auth/auth.js', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockSession(...args),
    },
  },
}));

describe('Auth middleware', () => {
  beforeEach(() => {
    mockSession.mockReset();
  });

  const app = new Hono();
  app.use('*', authMiddleware);
  app.get('/protected', (c) => c.json({ userId: c.get('userId') }));

  it('rejects requests without Authorization header', async () => {
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects requests with non-Bearer scheme', async () => {
    const res = await app.request('/protected', {
      headers: { Authorization: 'Basic dGVzdDp0ZXN0' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests when no valid session', async () => {
    mockSession.mockResolvedValue(null);
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer some-token' },
    });
    expect(res.status).toBe(401);
  });

  it('passes valid sessions and sets userId', async () => {
    mockSession.mockResolvedValue({
      user: { id: 'user-42', email: 'valid@test.com', role: 'user' },
      session: { id: 'session-1' },
    });
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe('user-42');
  });
});
