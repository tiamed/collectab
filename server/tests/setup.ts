import { vi } from 'vitest';

// Mock environment variables for tests
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/collectab_test';
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-at-least-32-characters';
process.env.BETTER_AUTH_URL = 'http://localhost:3099';
process.env.PORT = '3099';
process.env.DEFAULT_ROLE = 'guest';
process.env.INVITE_MODE = 'open';
