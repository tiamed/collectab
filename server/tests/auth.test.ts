import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { meRoutes } from '../src/api/routes/me.js';

const mockSession = vi.fn();

vi.mock('../src/auth/auth.js', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockSession(...args),
    },
  },
}));

vi.mock('../src/database/client.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([
          {
            id: 'test-user-id-123',
            email: 'test@test.com',
            name: 'Test User',
            avatarUrl: null,
            role: 'guest',
          },
        ]),
      }),
    }),
  }),
}));

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    mockSession.mockReset();
  });

  const app = new Hono();
  app.route('/api/auth/me', meRoutes);

  it('rejects requests without token', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects requests with invalid token', async () => {
    mockSession.mockResolvedValue(null);
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid session', async () => {
    mockSession.mockResolvedValue({
      user: { id: 'test-user-id-123', email: 'test@test.com', role: 'guest' },
      session: { id: 'session-1' },
    });
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('test@test.com');
    expect(body.user.role).toBe('guest');
  });
});
