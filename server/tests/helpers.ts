import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { vi } from 'vitest';
import { spaceRoutes } from '../src/api/routes/spaces.js';
import { collectionRoutes } from '../src/api/routes/collections.js';
import { bookmarkRoutes } from '../src/api/routes/bookmarks.js';
import { searchRoutes } from '../src/api/routes/search.js';

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/auth/auth.js', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

export function mockAuthSession(userId: string, role = 'user') {
  getSessionMock.mockResolvedValue({
    user: { id: userId, email: 'test@example.com', role },
    session: { id: 'mock-session' },
  });
}

export function createTestApp() {
  const app = new Hono();
  app.use('*', cors());
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/api/spaces', spaceRoutes);
  app.route('/api/collections', collectionRoutes);
  app.route('/api/bookmarks', bookmarkRoutes);
  app.route('/api/search', searchRoutes);
  return app;
}

export function generateTestToken(userId: string, _email: string = 'test@example.com') {
  mockAuthSession(userId);
  return `mock-token-${userId}`;
}
