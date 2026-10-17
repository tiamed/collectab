import { describe, it, expect } from 'vitest';
import { getQuotaForRole } from '../src/auth/quota.js';

describe('getQuotaForRole', () => {
  it('gives admins no bookmark cap by default', () => {
    expect(getQuotaForRole('admin')).toBeNull();
  });

  it('falls back to the guest quota for unknown roles', () => {
    expect(getQuotaForRole('guest')).toBe(10);
    expect(getQuotaForRole(null)).toBe(10);
    expect(getQuotaForRole('something-else')).toBe(10);
    expect(getQuotaForRole('user')).toBe(500);
  });
});
