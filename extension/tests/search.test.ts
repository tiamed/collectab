import { describe, it, expect } from 'vitest';
import type { Bookmark, SearchResult } from '../lib/api';
import { bookmarkMatches, groupSearchResults, highlightSegments, searchTerms } from '../lib/search';

function bm(id: string, over: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    collectionId: 'c1',
    title: id,
    url: `https://${id}.example.com`,
    description: null,
    favicon: null,
    tags: [],
    orderIndex: 0,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function result(id: string, spaceId: string, orgId: string | null, opts: { col?: number; idx?: number; spaceOrder?: number } = {}): SearchResult {
  return {
    bookmark: bm(id, { orderIndex: opts.idx ?? 0 }),
    collection: { id: `col-${opts.col ?? 0}`, name: `Col ${opts.col ?? 0}`, icon: null, orderIndex: opts.col ?? 0 },
    space: { id: spaceId, name: spaceId, icon: null, orgId, orderIndex: opts.spaceOrder ?? 0 },
    org: orgId ? { id: orgId, name: orgId, icon: null } : null,
  };
}

describe('bookmarkMatches', () => {
  it('requires every term across title/url/description/tags', () => {
    const b = bm('x', { title: 'React 文档', url: 'https://react.dev', tags: ['frontend'] });
    expect(bookmarkMatches(b, searchTerms('react 文档'))).toBe(true);
    expect(bookmarkMatches(b, searchTerms('dev frontend'))).toBe(true);
    expect(bookmarkMatches(b, searchTerms('react vue'))).toBe(false);
    expect(bookmarkMatches(b, [])).toBe(false);
  });
});

describe('groupSearchResults', () => {
  it('puts the current space first, then same-org spaces, keeping on-screen order inside a group', () => {
    const groups = groupSearchResults(
      [
        result('other-org', 's-org', 'org-1'),
        result('personal-b', 's-personal-2', null, { spaceOrder: 2 }),
        result('cur-2', 's-current', null, { col: 1, idx: 0 }),
        result('cur-1', 's-current', null, { col: 0, idx: 3 }),
        result('personal-a', 's-personal-1', null, { spaceOrder: 1 }),
      ],
      { activeSpaceId: 's-current', activeOrgId: null },
    );
    expect(groups.map((g) => g.space.id)).toEqual(['s-current', 's-personal-1', 's-personal-2', 's-org']);
    expect(groups[0].results.map((r) => r.bookmark.id)).toEqual(['cur-1', 'cur-2']);
  });
});

describe('highlightSegments', () => {
  it('marks every case-insensitive occurrence of each term', () => {
    expect(highlightSegments('GitHub hub', ['hub'])).toEqual([
      { text: 'Git', match: false },
      { text: 'Hub', match: true },
      { text: ' ', match: false },
      { text: 'hub', match: true },
    ]);
  });
});
