import type { Bookmark, SearchResult } from './api';

export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term must appear somewhere in title/url/description/tags (mirrors server ILIKE). */
export function bookmarkMatches(bookmark: Bookmark, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const haystack = [
    bookmark.title,
    bookmark.url,
    bookmark.description ?? '',
    ...(bookmark.tags ?? []),
  ].join(' ').toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export interface SearchGroup {
  space: SearchResult['space'];
  org: SearchResult['org'];
  results: SearchResult[];
}

/**
 * Group by space. Current space first, then spaces of the current org/personal
 * area, then everything else; inside a group results follow the on-screen
 * collection/bookmark order so "where is it" matches what the space shows.
 */
export function groupSearchResults(
  results: SearchResult[],
  ctx: { activeSpaceId: string | null; activeOrgId: string | null },
): SearchGroup[] {
  const byId = new Map<string, SearchGroup>();
  for (const r of results) {
    let g = byId.get(r.space.id);
    if (!g) {
      g = { space: r.space, org: r.org, results: [] };
      byId.set(r.space.id, g);
    }
    g.results.push(r);
  }

  const rank = (g: SearchGroup) => {
    if (g.space.id === ctx.activeSpaceId) return 0;
    if ((g.space.orgId ?? null) === (ctx.activeOrgId ?? null)) return 1;
    return 2;
  };

  const groups = [...byId.values()];
  for (const g of groups) {
    g.results.sort(
      (a, b) =>
        a.collection.orderIndex - b.collection.orderIndex ||
        a.collection.name.localeCompare(b.collection.name) ||
        a.bookmark.orderIndex - b.bookmark.orderIndex,
    );
  }
  groups.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.org?.name ?? '').localeCompare(b.org?.name ?? '') ||
      a.space.orderIndex - b.space.orderIndex ||
      a.space.name.localeCompare(b.space.name),
  );
  return groups;
}

/** Split `text` into plain/matched segments for highlighting. */
export function highlightSegments(text: string, terms: string[]): { text: string; match: boolean }[] {
  if (!text || terms.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [{ text, match: false }];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    let from = 0;
    while (t && (from = lower.indexOf(t, from)) !== -1) {
      for (let i = from; i < from + t.length; i++) marks[i] = true;
      from += t.length;
    }
  }
  const out: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.match === marks[i]) last.text += text[i];
    else out.push({ text: text[i], match: marks[i] });
  }
  return out;
}
