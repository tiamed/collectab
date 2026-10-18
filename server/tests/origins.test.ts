import { describe, it, expect } from 'vitest';
import {
  corsOrigin,
  extensionOrigins,
  isAllowedExtensionRedirect,
  isExtensionOrigin,
  trustedOrigins,
} from '../src/auth/origins.js';
import { parseEnv, productionConfigErrors } from '../src/config/env.js';

const CHROME_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba';

const base = parseEnv({ BETTER_AUTH_URL: 'https://api.example.com' });
const pinned = parseEnv({ BETTER_AUTH_URL: 'https://api.example.com', EXTENSION_IDS: CHROME_ID });

describe('BETTER_AUTH_URL normalisation', () => {
  it.each([
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://api.example.com/api', 'https://api.example.com'],
    ['https://api.example.com/api/auth/', 'https://api.example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(parseEnv({ BETTER_AUTH_URL: input }).BETTER_AUTH_URL).toBe(expected);
  });
});

describe('trusted origins', () => {
  it('trusts the server itself and any extension when EXTENSION_IDS is empty', () => {
    expect(trustedOrigins(base)).toEqual(['https://api.example.com', 'chrome-extension://', 'moz-extension://']);
    expect(isExtensionOrigin(`chrome-extension://${CHROME_ID}`, base)).toBe(true);
    expect(isExtensionOrigin('moz-extension://4b1c1a3e-0000-4000-8000-000000000000', base)).toBe(true);
    expect(isExtensionOrigin('chrome-extension://', base)).toBe(false);
  });

  it('pins to the configured Chrome extension IDs', () => {
    expect(extensionOrigins(pinned)).toEqual([`chrome-extension://${CHROME_ID}`]);
    expect(isExtensionOrigin(`chrome-extension://${CHROME_ID}`, pinned)).toBe(true);
    expect(isExtensionOrigin(`chrome-extension://${OTHER_ID}`, pinned)).toBe(false);
  });

  it('accepts full origins in EXTENSION_IDS', () => {
    const env = parseEnv({ EXTENSION_IDS: `${CHROME_ID},moz-extension://` });
    expect(extensionOrigins(env)).toEqual([`chrome-extension://${CHROME_ID}`, 'moz-extension://']);
  });
});

describe('CORS', () => {
  it('echoes extension and own origins, rejects random websites', () => {
    expect(corsOrigin(`chrome-extension://${CHROME_ID}`, base)).toBe(`chrome-extension://${CHROME_ID}`);
    expect(corsOrigin('https://api.example.com', base)).toBe('https://api.example.com');
    expect(corsOrigin('https://evil.example', base)).toBeNull();
    expect(corsOrigin(undefined, base)).toBeNull();
  });

  it('honours CORS_ORIGIN extras and the * wildcard', () => {
    expect(corsOrigin('https://web.example', parseEnv({ CORS_ORIGIN: 'https://web.example' }))).toBe('https://web.example');
    expect(corsOrigin('https://evil.example', parseEnv({ CORS_ORIGIN: '*' }))).toBe('*');
  });
});

describe('OAuth extension redirect allow-list', () => {
  it('accepts chromiumapp.org / allizom redirects', () => {
    expect(isAllowedExtensionRedirect(`https://${CHROME_ID}.chromiumapp.org/oauth`, base)).toBe(true);
    expect(isAllowedExtensionRedirect(`https://${'a'.repeat(40)}.extensions.allizom.org/`, base)).toBe(true);
  });

  it('rejects anything that could leak the token', () => {
    for (const bad of [
      'https://evil.example/',
      `http://${CHROME_ID}.chromiumapp.org/`,
      `https://${CHROME_ID}.chromiumapp.org.evil.example/`,
      `https://user:pw@${CHROME_ID}.chromiumapp.org/`,
      `https://${CHROME_ID}.chromiumapp.org:8443/`,
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedExtensionRedirect(bad, base), bad).toBe(false);
    }
  });

  it('only allows pinned IDs when EXTENSION_IDS is set', () => {
    expect(isAllowedExtensionRedirect(`https://${CHROME_ID}.chromiumapp.org/`, pinned)).toBe(true);
    expect(isAllowedExtensionRedirect(`https://${OTHER_ID}.chromiumapp.org/`, pinned)).toBe(false);
    expect(isAllowedExtensionRedirect(`https://${'a'.repeat(40)}.extensions.allizom.org/`, pinned)).toBe(false);
  });
});

describe('production config checks', () => {
  const prod = (extra: Record<string, string>) =>
    productionConfigErrors(
      parseEnv({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'x'.repeat(40),
        BETTER_AUTH_URL: 'https://api.example.com',
        ...extra,
      }),
    );

  it('passes a sane production config', () => {
    expect(prod({})).toEqual([]);
  });

  it('rejects the example secret and plain-http public URLs', () => {
    expect(prod({ BETTER_AUTH_SECRET: 'change-this-to-a-random-secret-at-least-32-chars' })).toHaveLength(1);
    expect(prod({ BETTER_AUTH_URL: 'http://api.example.com' })).toHaveLength(1);
    expect(prod({ BETTER_AUTH_URL: 'http://localhost:3001' })).toEqual([]);
  });

  it('rejects half-configured Google OAuth', () => {
    expect(prod({ OAUTH_GOOGLE_CLIENT_ID: 'id' })).toHaveLength(1);
  });
});
