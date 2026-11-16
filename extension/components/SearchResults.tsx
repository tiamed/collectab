import { useEffect, useRef, useState } from 'react';
import { ChevronRight, LocateFixed, SearchX } from 'lucide-react';
import IconDisplay from './IconDisplay';
import type { SearchResult } from '@/lib/api';
import { highlightSegments, type SearchGroup } from '@/lib/search';

export type SearchScope = 'all' | 'space';

interface SearchResultsProps {
  query: string;
  terms: string[];
  groups: SearchGroup[];
  totalCount: number;
  spaceCount: number;
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  activeSpaceId: string | null;
  activeSpaceName: string;
  personalName: string;
  loading: boolean;
  offline: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onLocate: (result: SearchResult) => void;
  onOpenSpace: (space: SearchResult['space']) => void;
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlightSegments(text, terms).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-sm bg-[var(--accent)]/25 text-inherit">{seg.text}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function domainOf(url: string) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url; }
}

function ResultRow({
  result,
  terms,
  active,
  onHover,
  onLocate,
}: {
  result: SearchResult;
  terms: string[];
  active: boolean;
  onHover: () => void;
  onLocate: () => void;
}) {
  const { bookmark, collection } = result;
  const [faviconFailed, setFaviconFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      ref={ref}
      onMouseMove={onHover}
      className={`group flex items-center gap-2 rounded-md px-2 ${active ? 'bg-[var(--surface)]' : ''}`}
    >
      <a
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 items-center gap-3 py-1.5"
      >
        {bookmark.favicon && !faviconFailed ? (
          <img
            src={bookmark.favicon}
            alt=""
            className="size-4 shrink-0 rounded-sm"
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          <div className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-[var(--muted)]/20 text-[8px] font-bold text-[var(--muted)]">
            {bookmark.title[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-xs font-medium text-[var(--foreground)]">
              <Highlighted text={bookmark.title} terms={terms} />
            </span>
            <span className="shrink-0 truncate text-[10px] text-[var(--muted)]">
              <Highlighted text={domainOf(bookmark.url)} terms={terms} />
            </span>
          </div>
          {bookmark.description && (
            <p className="truncate text-[10px] text-[var(--muted)]">
              <Highlighted text={bookmark.description} terms={terms} />
            </p>
          )}
        </div>
      </a>
      <span
        className="flex max-w-[180px] shrink-0 items-center gap-1 truncate rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] group-hover:bg-[var(--background)]"
        title={`Collection: ${collection.name}`}
      >
        <IconDisplay icon={collection.icon ?? ''} fallback="📁" className="text-[10px] leading-none" imgClassName="size-3 rounded-sm object-contain" />
        <span className="truncate">{collection.name}</span>
      </span>
      <button
        onClick={onLocate}
        className={`flex size-6 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--accent)] ${
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        title="Show in space (Shift+Enter)"
      >
        <LocateFixed className="size-3.5" />
      </button>
    </div>
  );
}

export default function SearchResults({
  query,
  terms,
  groups,
  totalCount,
  spaceCount,
  scope,
  onScopeChange,
  activeSpaceId,
  activeSpaceName,
  personalName,
  loading,
  offline,
  activeIndex,
  onActiveIndexChange,
  onLocate,
  onOpenSpace,
}: SearchResultsProps) {
  const shownCount = groups.reduce((n, g) => n + g.results.length, 0);
  let flatIndex = 0;

  const scopeTab = (value: SearchScope, label: string, count: number) => (
    <button
      onClick={() => onScopeChange(value)}
      className={`flex max-w-[220px] items-center gap-1.5 rounded px-2 py-1 text-[11px] ${
        scope === value
          ? 'bg-[var(--surface)] text-[var(--foreground)]'
          : 'text-[var(--muted)] hover:text-[var(--foreground)]'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-[10px] text-[var(--muted)]">{count}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] px-6">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-sm font-semibold text-[var(--foreground)]">
            Results for “{query.trim()}”
          </h1>
          <span className="shrink-0 text-[11px] text-[var(--muted)]">
            {loading ? 'Searching…' : offline ? 'Offline · cached spaces only' : `${shownCount} found`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {scopeTab('all', 'All spaces', totalCount)}
          {activeSpaceId && scopeTab('space', activeSpaceName || 'This space', spaceCount)}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {shownCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted)]">
            <SearchX className="size-6" strokeWidth={1.5} />
            <span className="text-sm">{loading ? 'Searching…' : 'No bookmarks match'}</span>
            {!loading && scope === 'space' && totalCount > 0 && (
              <button
                onClick={() => onScopeChange('all')}
                className="text-[11px] text-[var(--accent)] hover:underline"
              >
                {totalCount} match{totalCount === 1 ? '' : 'es'} in other spaces
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.space.id}>
                <button
                  onClick={() => onOpenSpace(group.space)}
                  className="group/space mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-[var(--surface)]"
                  title="Open this space"
                >
                  <IconDisplay icon={group.space.icon ?? ''} fallback="●" className="flex size-4 items-center justify-center text-xs leading-none" imgClassName="size-4 rounded-sm object-contain" />
                  <span className="truncate text-xs font-semibold text-[var(--foreground)]">{group.space.name}</span>
                  <span className="shrink-0 truncate text-[10px] text-[var(--muted)]">
                    {group.org ? group.org.name : personalName}
                  </span>
                  {group.space.id === activeSpaceId && (
                    <span className="shrink-0 rounded bg-[var(--accent)]/15 px-1 text-[9px] font-medium text-[var(--accent)]">
                      current
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">{group.results.length}</span>
                  <ChevronRight className="ml-auto size-3 shrink-0 text-[var(--muted)] opacity-0 group-hover/space:opacity-100" />
                </button>
                <div>
                  {group.results.map((r) => {
                    const idx = flatIndex++;
                    return (
                      <ResultRow
                        key={r.bookmark.id}
                        result={r}
                        terms={terms}
                        active={idx === activeIndex}
                        onHover={() => { if (idx !== activeIndex) onActiveIndexChange(idx); }}
                        onLocate={() => onLocate(r)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--border)] px-6 text-[10px] text-[var(--muted)]">
        <span><kbd className="font-sans">↑ ↓</kbd> select</span>
        <span><kbd className="font-sans">Enter</kbd> open</span>
        <span><kbd className="font-sans">Shift+Enter</kbd> show in space</span>
        <span><kbd className="font-sans">Esc</kbd> clear</span>
      </div>
    </div>
  );
}
