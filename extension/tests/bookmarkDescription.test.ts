import { describe, expect, it } from 'vitest';
import { descriptionForCreate, descriptionForUpdate } from '../lib/bookmarkDescription';

describe('descriptionForCreate', () => {
  it('keeps a non-empty description for the popup save payload', () => {
    expect(descriptionForCreate('  A note  ')).toBe('A note');
  });

  it('omits a blank description', () => {
    const body = {
      title: 'Example',
      url: 'https://example.com',
      description: descriptionForCreate('   '),
    };
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      title: 'Example',
      url: 'https://example.com',
    });
  });
});

describe('descriptionForUpdate', () => {
  it('sends null when the description is cleared so JSON does not drop the field', () => {
    const body = {
      title: 'Example',
      url: 'https://example.com',
      description: descriptionForUpdate(''),
    };
    expect(descriptionForUpdate('   ')).toBeNull();
    expect(descriptionForUpdate(null)).toBeNull();
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      title: 'Example',
      url: 'https://example.com',
      description: null,
    });
  });

  it('keeps a non-empty description', () => {
    expect(descriptionForUpdate('  Still here  ')).toBe('Still here');
  });

  it('omits description when the update does not include it', () => {
    const body = {
      title: 'Example',
      description: descriptionForUpdate(undefined),
    };
    expect(JSON.parse(JSON.stringify(body))).toEqual({ title: 'Example' });
  });
});
