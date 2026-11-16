import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Bookmark } from '@/lib/api';

interface DraggableBookmarkListProps {
  collectionId: string;
  bookmarks: Bookmark[];
  onEdit: (bookmark: Bookmark) => void;
  onDelete: (id: string) => void;
  onAddClick: () => void;
  readOnly?: boolean;
  highlightedId?: string | null;
}

function SortableBookmarkCard({
  bookmark,
  onEdit,
  onDelete,
  readOnly,
  highlighted,
}: {
  bookmark: Bookmark;
  onEdit: () => void;
  onDelete: () => void;
  readOnly?: boolean;
  highlighted?: boolean;
}) {
  // Track which src failed so a new favicon URL after sync/edit retries <img>
  const [failedFavicon, setFailedFavicon] = useState<string | null>(null);
  const showFavicon = Boolean(bookmark.favicon) && failedFavicon !== bookmark.favicon;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: bookmark.id,
    data: { type: 'bookmark', collectionId: bookmark.collectionId },
    disabled: readOnly,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: `${transition ?? ''} box-shadow 0.2s, opacity 0.2s`,
    opacity: isDragging ? 0.3 : undefined,
    zIndex: isDragging ? 999 : undefined,
    position: isDragging ? 'relative' as const : undefined,
    boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.15)' : undefined,
  };

  const domain = (() => {
    try { return new URL(bookmark.url).hostname.replace('www.', ''); }
    catch { return bookmark.url; }
  })();

  return (
    <a
      ref={setNodeRef}
      style={style}
      href={bookmark.url}
      target="_blank"
      rel="noopener noreferrer"
      data-bookmark-id={bookmark.id}
      className={`group relative flex w-[168px] flex-col gap-1.5 rounded-md bg-[var(--surface)] p-2.5 transition-colors hover:brightness-95 dark:hover:brightness-110 ${
        highlighted ? 'ring-2 ring-[var(--accent)] animate-pulse' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      {!readOnly && (
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="flex size-5 items-center justify-center rounded bg-[var(--background)]/80 text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
          >
            <Pencil className="size-3" />
          </button>
          <button
            className="flex size-5 items-center justify-center rounded bg-[var(--background)]/80 text-[var(--muted)] hover:text-red-400"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        {showFavicon ? (
          <img
            src={bookmark.favicon!}
            alt=""
            className="size-4 shrink-0 rounded-sm"
            onError={() => setFailedFavicon(bookmark.favicon ?? null)}
          />
        ) : (
          <div className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-[var(--muted)]/20 text-[8px] font-bold text-[var(--muted)]">
            {bookmark.title[0]?.toUpperCase()}
          </div>
        )}
        <span className="truncate text-xs font-medium text-[var(--foreground)]">{bookmark.title}</span>
      </div>
      {bookmark.description && (
        <p className="line-clamp-2 text-[10px] leading-[1.3] text-[var(--muted)]">
          {bookmark.description}
        </p>
      )}
      {!bookmark.description && (
        <p className="truncate text-[10px] text-[var(--muted)]">{domain}</p>
      )}
    </a>
  );
}

export default function DraggableBookmarkList({
  collectionId,
  bookmarks,
  onEdit,
  onDelete,
  onAddClick,
  readOnly = false,
  highlightedId,
}: DraggableBookmarkListProps) {
  const { setNodeRef } = useDroppable({
    id: `collection-${collectionId}`,
    data: { type: 'collection', collectionId },
    disabled: readOnly,
  });

  return (
    <div
      ref={setNodeRef}
      data-collection-id={collectionId}
      className="flex min-h-[60px] flex-wrap gap-3"
    >
      <SortableContext items={bookmarks.map((b) => b.id)} strategy={rectSortingStrategy}>
        {bookmarks.map((bookmark) => (
          <SortableBookmarkCard
            key={bookmark.id}
            bookmark={bookmark}
            onEdit={() => onEdit(bookmark)}
            onDelete={() => onDelete(bookmark.id)}
            readOnly={readOnly}
            highlighted={bookmark.id === highlightedId}
          />
        ))}
      </SortableContext>
      {!readOnly && bookmarks.length === 0 && (
        <button
          onClick={onAddClick}
          className="flex w-[168px] items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          Add bookmark
        </button>
      )}
    </div>
  );
}
