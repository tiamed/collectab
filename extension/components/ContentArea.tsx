import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, DragOverlay, closestCorners, closestCenter, MeasuringStrategy, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { ChevronDown, ChevronRight, Plus, MoreHorizontal, Pencil, Trash2, Settings } from 'lucide-react';
import BookmarkCard from './BookmarkCard';
import EditBookmarkModal from './EditBookmarkModal';
import AddBookmarkModal from './AddBookmarkModal';
import DraggableBookmarkList from './DraggableBookmarkList';
import IconDisplay from './IconDisplay';
import type { Collection, Bookmark } from '@/lib/api';

interface ContentAreaProps {
  spaceId: string | null;
  collections: Collection[];
  bookmarksByCollection: Record<string, Bookmark[]>;
  loading: boolean;
  onUpdateBookmark: (id: string, updates: Partial<Bookmark>) => Promise<Bookmark>;
  onDeleteBookmark: (id: string) => Promise<void>;
  onAddBookmark: (params: { collectionId: string; title: string; url: string; description?: string; favicon?: string; tags?: string[] }) => Promise<Bookmark>;
  onRenameCollection: (id: string, name: string) => void;
  onDeleteCollection: (id: string) => void;
  onOpenCollectionSettings: (collection: Collection) => void;
  onCollectionReorder: (collectionId: string, orderedBookmarks: Bookmark[], meta: { bookmarkId: string; fromIndex: number; toIndex: number }) => void;
  onTransferBookmark: (bookmarkId: string, fromCollectionId: string, targetCollectionId: string, newIndex: number) => Promise<void>;
  allCollapsed: boolean | null;
  onResetCollapsed: () => void;
  /** When false, hide collection edit affordances (viewer) */
  canEditContent?: boolean;
}

export default function ContentArea({
  spaceId,
  collections,
  bookmarksByCollection,
  loading,
  onUpdateBookmark,
  onDeleteBookmark,
  onAddBookmark,
  onRenameCollection,
  onDeleteCollection,
  onOpenCollectionSettings,
  onCollectionReorder,
  onTransferBookmark,
  allCollapsed,
  onResetCollapsed,
  canEditContent = true,
}: ContentAreaProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  // Live mirror of bookmarksByCollection, mutated during drag so cross-collection
  // moves animate in real time (target SortableContext re-computes positions).
  const [dragItems, setDragItems] = useState<Record<string, Bookmark[]> | null>(null);
  const dragItemsRef = useRef<Record<string, Bookmark[]> | null>(null);
  const collectionsRef = useRef(collections);
  // The mirror itself is the single source of truth for X's position during a
  // drag (mirror lists are X-inclusive). dragOver mutates it; dragEnd reads it
  // back. Do NOT read active.data.current.collectionId — the mirror re-render
  // mutates X's sortable data, which would feed back into the drag handler and
  // cause an infinite over-change loop (React #185).
  const lastOverIdRef = useRef<string | null>(null);
  const recentlyMovedToNewContainer = useRef(false);
  dragItemsRef.current = dragItems;
  collectionsRef.current = collections;
  const dragSnapshotRef = useRef<{ bookmarkId: string; fromCollectionId: string; originalIndex: number } | null>(null);
  const dragGenRef = useRef(0);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      recentlyMovedToNewContainer.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [dragItems]);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [addingToCollection, setAddingToCollection] = useState<string | null>(null);
  const [menuColId, setMenuColId] = useState<string | null>(null);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editColName, setEditColName] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [spaceId]);

  useEffect(() => {
    if (allCollapsed === null) return;
    const next: Record<string, boolean> = {};
    collections.forEach((c) => { next[c.id] = allCollapsed; });
    setCollapsed(next);
    onResetCollapsed();
  }, [allCollapsed, collections, onResetCollapsed]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuColId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (editingColId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingColId]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const commitRenameCol = () => {
    if (editingColId && editColName.trim()) {
      onRenameCollection(editingColId, editColName.trim());
    }
    setEditingColId(null);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const activeSensors = canEditContent ? sensors : [];

  // Grid layout (flex-wrap) has gaps between rows/columns that pointerWithin
  // cannot hit — the pointer must be strictly inside a droppable rect, so over
  // would lag and the first slot of a collection (above its first bookmark)
  // would never trigger. closestCorners is distance-based with no dead zones.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const hits = closestCorners(args);
    const first = hits[0]?.id;
    if (typeof first === 'string' && first.startsWith('collection-')) {
      const colId = first.slice('collection-'.length);
      const bookmarks = args.droppableContainers.filter(
        (c) =>
          c.id !== args.active?.id &&
          c.data?.current &&
          (c.data.current as { type: string; collectionId: string }).type === 'bookmark' &&
          (c.data.current as { type: string; collectionId: string }).collectionId === colId,
      );
      if (bookmarks.length > 0) {
        const closest = closestCenter({ ...args, droppableContainers: bookmarks });
        if (closest.length > 0) {
          lastOverIdRef.current = String(closest[0].id);
          return closest;
        }
      }
    }
    if (hits.length > 0) {
      // closestCorners ranks full-width collection droppables below nearby
      // bookmark cards (corner distance grows with rect width), so an EMPTY
      // collection can never win by distance alone. When the active rect
      // actually overlaps an empty collection, target it directly.
      const activeRect = args.active?.rect.current.translated;
      if (activeRect) {
        const emptyCol = args.droppableContainers.find((c) => {
          if (typeof c.id !== 'string' || !c.id.startsWith('collection-')) return false;
          if (c.id === args.active?.id) return false;
          const data = c.data?.current as { type: string; collectionId: string } | null;
          if (data?.type !== 'collection') return false;
          const colId = c.id.slice('collection-'.length);
          const hasBookmarks = args.droppableContainers.some(
            (oc) =>
              oc.id !== args.active?.id &&
              (oc.data?.current as { type: string; collectionId: string } | null)?.type === 'bookmark' &&
              (oc.data?.current as { type: string; collectionId: string } | null)?.collectionId === colId,
          );
          if (hasBookmarks) return false;
          const rect = args.droppableRects.get(c.id);
          if (!rect) return false;
          return (
            activeRect.left < rect.left + rect.width &&
            activeRect.left + activeRect.width > rect.left &&
            activeRect.top < rect.top + rect.height &&
            activeRect.top + activeRect.height > rect.top
          );
        });
        if (emptyCol) {
          lastOverIdRef.current = String(emptyCol.id);
          return [{ id: emptyCol.id }];
        }
      }
    }
    if (hits.length > 0) {
      lastOverIdRef.current = String(hits[0].id);
      return hits;
    }
    if (recentlyMovedToNewContainer.current) {
      lastOverIdRef.current = args.active?.id != null ? String(args.active.id) : null;
    }
    return lastOverIdRef.current ? [{ id: lastOverIdRef.current }] : [];
  }, [dragItems, bookmarksByCollection]);

  const activeBookmark = useMemo(() => {
    if (!activeId) return null;
    for (const bks of Object.values(bookmarksByCollection)) {
      const found = bks.find((b) => b.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, bookmarksByCollection]);

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    // Find X's actual collection from the committed REST state instead of
    // trusting active.data.current.collectionId, which can be stale between
    // two rapid drags (the sortable data re-registers on re-render).
    let fromColId: string | null = null;
    for (const [colId, list] of Object.entries(bookmarksByCollection)) {
      if (list.some((b) => b.id === active.id)) { fromColId = colId; break; }
    }
    if (fromColId != null) {
      const srcList = bookmarksByCollection[fromColId] || [];
      dragSnapshotRef.current = {
        bookmarkId: active.id as string,
        fromCollectionId: fromColId,
        originalIndex: srcList.findIndex((b) => b.id === active.id),
      };
      dragGenRef.current += 1;
      setDragItems(
        Object.fromEntries(
          Object.entries(bookmarksByCollection).map(([colId, list]) => [colId, [...list]]),
        ),
      );
    }
    setActiveId(active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    const overData = over?.data.current as { type: string; collectionId: string } | null;
    if (!over) return;
    if (!overData || (overData.type !== 'bookmark' && overData.type !== 'collection')) return;
    // Self-over (hovering X's own slot): no-op, keep the mirror as-is. Reading
    // X's data here would be stale and teleport X to the end of the collection.
    if (over.id === active.id) return;

    const activeId = active.id as string;
    const targetColId = overData.collectionId;

    setDragItems((prev) => {
      if (!prev) return prev;

      // The mirror is the single source of truth for X's position.
      let fromColId: string | null = null;
      let fromIndex = -1;
      for (const [colId, list] of Object.entries(prev)) {
        const idx = list.findIndex((b) => b.id === activeId);
        if (idx !== -1) { fromColId = colId; fromIndex = idx; break; }
      }
      if (fromColId == null || fromIndex === -1) return prev;

      // Same-collection movement: dnd-kit's SortableContext handles the visual
      // re-order natively — do NOT mutate the mirror array (it would break the
      // sort animation). The mirror already contains X at its committed slot.
      if (fromColId === targetColId) {
        return prev;
      }

      const next: Record<string, Bookmark[]> = {};
      for (const [colId, list] of Object.entries(prev)) next[colId] = [...list];

      const [moved] = next[fromColId].splice(fromIndex, 1);
      const movedItem = { ...moved, collectionId: targetColId };

      if (overData.type === 'bookmark') {
        const target = next[targetColId] || [];
        const overIndex = target.findIndex((b) => b.id === over.id);
        // Official isBelowOverItem modifier: when X's bottom is past over's
        // bottom, insert AFTER over, not before. Without this, drops land one
        // slot late (dnd-kit issue #1080: "next to last" bug).
        const isBelowOverItem =
          over != null &&
          active.rect.current.translated != null &&
          active.rect.current.translated.top > over.rect.top + over.rect.height;
        const modifier = isBelowOverItem ? 1 : 0;
        const insertAt = overIndex === -1 ? target.length : Math.min(overIndex + modifier, target.length);
        target.splice(insertAt, 0, movedItem);
        next[targetColId] = target;
      } else {
        next[targetColId] = [...(next[targetColId] || []), movedItem];
      }

      recentlyMovedToNewContainer.current = true;
      return next;
    });
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const snapshot = dragSnapshotRef.current;
    const overData = over?.data.current as { type: string; collectionId: string } | null;
    dragSnapshotRef.current = null;
    lastOverIdRef.current = null;
    recentlyMovedToNewContainer.current = false;

    if (!snapshot) {
      setActiveId(null);
      setDragItems(null);
      return;
    }

    const activeId = active.id as string;
    const overIsSelf = over != null && over.id === activeId;
    const overIsBookmark = !overIsSelf && overData?.type === 'bookmark';
    const overIsCollection = !overIsSelf && overData?.type === 'collection';

    // Determine the target collection. When over is X itself (hovering its own
    // slot in the target grid), X's own data carries its pre-drag collection,
    // so fall back to the mirror position.
    let targetColId: string | null = null;
    if (overIsSelf) {
      for (const [colId, list] of Object.entries(dragItems ?? {})) {
        if (list.some((b) => b.id === activeId)) { targetColId = colId; break; }
      }
    } else if (overIsBookmark || overIsCollection) {
      targetColId = overData?.collectionId ?? null;
    }

    if (!over || targetColId == null) {
      setActiveId(null);
      setDragItems(null);
      return;
    }

    // X never left its collection (or was dropped back onto it): keep the
    // original in-collection arrayMove behavior; collection droppable = no-op.
    if (targetColId === snapshot.fromCollectionId) {
      if (overIsBookmark) {
        const current = bookmarksByCollection[targetColId] || [];
        const overIndex = current.findIndex((b) => b.id === over?.id);
        if (overIndex !== -1 && snapshot.originalIndex !== overIndex) {
          onCollectionReorder(targetColId, arrayMove(current, snapshot.originalIndex, overIndex), {
            bookmarkId: activeId,
            fromIndex: snapshot.originalIndex,
            toIndex: overIndex,
          });
        }
      }
      setActiveId(null);
      setDragItems(null);
      return;
    }

    // Cross-collection: X is already a member of the target mirror list (it was
    // inserted on boundary entry, then SortableContext animated it natively for
    // in-collection moves). The mirror list is X-inclusive, so X's own index in
    // the *re-ordered* mirror equals the insertion index into the X-free
    // committed list (X's index = count of real items before it). Apply the same
    // arrayMove that SortableContext just animated: move X from its current
    // mirror slot to over's mirror slot. This is the official MultipleContainers
    // dragEnd semantics and resolves self-over naturally (indexes equal → no-op).
    const mirrorList = dragItems?.[targetColId] ?? [];
    const activeMirrorIndex = mirrorList.findIndex((b) => b.id === activeId);
    let newIndex: number;

    if (overIsBookmark) {
      const overMirrorIndex = mirrorList.findIndex((b) => b.id === over?.id);
      if (activeMirrorIndex !== -1 && overMirrorIndex !== -1) {
        if (activeMirrorIndex === overMirrorIndex) {
          newIndex = activeMirrorIndex;
        } else {
          newIndex = arrayMove(mirrorList, activeMirrorIndex, overMirrorIndex).findIndex((b) => b.id === activeId);
        }
      } else if (activeMirrorIndex !== -1) {
        newIndex = activeMirrorIndex;
      } else {
        newIndex = mirrorList.length;
      }
    } else {
      newIndex = activeMirrorIndex !== -1 ? activeMirrorIndex : mirrorList.length;
    }
    newIndex = Math.max(0, Math.min(newIndex, mirrorList.length));

    const gen = dragGenRef.current;
    setActiveId(null);
    // Snap the mirror to the committed position BEFORE clearing it. During the
    // drag, in-collection movement is animated by SortableContext without the
    // mirror array moving, so dragItems can still show X at its entry slot.
    // Reordering the mirror to newIndex now makes the release frame identical
    // to the committed props frame, eliminating the post-drop flicker.
    setDragItems((prev) => {
      if (!prev) return prev;
      const target = prev[targetColId];
      if (!target) return prev;
      const idx = target.findIndex((b) => b.id === activeId);
      if (idx === -1 || idx === newIndex) return prev;
      const next: Record<string, Bookmark[]> = {};
      for (const [colId, list] of Object.entries(prev)) next[colId] = [...list];
      next[targetColId] = arrayMove(target, idx, newIndex);
      return next;
    });
    void onTransferBookmark(activeId, snapshot.fromCollectionId, targetColId, newIndex).finally(() => {
      if (dragGenRef.current === gen) {
        setDragItems(null);
      }
    });
  }, [bookmarksByCollection, dragItems, onCollectionReorder, onTransferBookmark]);

  const handleDragCancel = useCallback(() => {
    dragSnapshotRef.current = null;
    lastOverIdRef.current = null;
    recentlyMovedToNewContainer.current = false;
    setActiveId(null);
    setDragItems(null);
  }, []);

  if (loading && collections.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-[var(--muted)]">Loading...</span>
      </div>
    );
  }

  const collectionIds = new Set(collections.map((c) => c.id));
  const bookmarkKeys = Object.keys(bookmarksByCollection);
  const bookmarksFromOtherSpace =
    bookmarkKeys.length > 0 && !bookmarkKeys.some((k) => collectionIds.has(k));
  if (loading && bookmarksFromOtherSpace) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-[var(--muted)]">Loading...</span>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-[var(--muted)]">No collections in this space</span>
      </div>
    );
  }

  return (
    <DndContext
      sensors={activeSensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
      {collections.map((collection) => {
        const bookmarks = dragItems?.[collection.id] ?? bookmarksByCollection[collection.id] ?? [];
        const isCollapsed = collapsed[collection.id] ?? false;

        return (
          <section key={collection.id} className="group/section">
            <div className="relative flex items-center gap-2 mb-3">
              <button
                className="flex items-center gap-1.5"
                onClick={() => toggleCollapse(collection.id)}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5 text-[var(--muted)]" strokeWidth={2} />
                ) : (
                  <ChevronDown className="size-3.5 text-[var(--muted)]" strokeWidth={2} />
                )}
              </button>

              {editingColId === collection.id ? (
                <input
                  ref={editInputRef}
                  className="rounded bg-[var(--background)] px-1.5 py-0.5 text-sm font-semibold text-[var(--foreground)] outline-none ring-1 ring-[var(--accent)]"
                  value={editColName}
                  onChange={(e) => setEditColName(e.target.value)}
                  onBlur={commitRenameCol}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRenameCol();
                    if (e.key === 'Escape') setEditingColId(null);
                  }}
                />
              ) : (
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                  <IconDisplay icon={collection.icon} fallback="📁" className="flex size-4 items-center justify-center text-sm leading-none" imgClassName="size-4 rounded-sm object-contain" />
                  {collection.name}
                </h2>
              )}

              <span className="text-[10px] text-[var(--muted)]">{bookmarks.length}</span>

              {canEditContent && (
                <button
                  onClick={() => setAddingToCollection(collection.id)}
                  className="flex size-5 items-center justify-center rounded text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--surface)] hover:text-[var(--foreground)] group-hover/section:opacity-100"
                  title="Add bookmark"
                >
                  <Plus className="size-3" strokeWidth={2} />
                </button>
              )}

              {canEditContent && (
                <button
                  className="flex size-5 items-center justify-center rounded text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--surface)] hover:text-[var(--foreground)] group-hover/section:opacity-100"
                  onClick={() => setMenuColId(menuColId === collection.id ? null : collection.id)}
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
              )}

              {canEditContent && menuColId === collection.id && (
                <div
                  ref={menuRef}
                  className="absolute left-20 top-6 z-50 min-w-[120px] rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
                >
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--foreground)] hover:bg-[var(--background)]"
                    onClick={() => {
                      setEditingColId(collection.id);
                      setEditColName(collection.name);
                      setMenuColId(null);
                    }}
                  >
                    <Pencil className="size-3" />
                    Rename
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--foreground)] hover:bg-[var(--background)]"
                    onClick={() => {
                      setMenuColId(null);
                      onOpenCollectionSettings(collection);
                    }}
                  >
                    <Settings className="size-3" />
                    Settings
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-[var(--background)]"
                    onClick={() => {
                      setMenuColId(null);
                      onDeleteCollection(collection.id);
                    }}
                  >
                    <Trash2 className="size-3" />
                    Delete
                  </button>
                </div>
              )}
            </div>

            {!isCollapsed && (
              <DraggableBookmarkList
                collectionId={collection.id}
                bookmarks={bookmarks}
                onEdit={canEditContent ? (b) => setEditingBookmark(b) : () => {}}
                onDelete={canEditContent ? (id) => onDeleteBookmark(id) : async () => {}}
                onAddClick={canEditContent ? () => setAddingToCollection(collection.id) : () => {}}
                readOnly={!canEditContent}
              />
            )}
          </section>
        );
      })}

      {editingBookmark && (
        <EditBookmarkModal
          bookmark={editingBookmark}
          collections={collections}
          onSave={async (updates) => {
            await onUpdateBookmark(editingBookmark.id, updates);
            setEditingBookmark(null);
          }}
          onClose={() => setEditingBookmark(null)}
        />
      )}

      {addingToCollection && (
        <AddBookmarkModal
          collectionId={addingToCollection}
          onSave={async (params) => {
            await onAddBookmark(params);
            setAddingToCollection(null);
          }}
          onClose={() => setAddingToCollection(null)}
        />
      )}
      <DragOverlay dropAnimation={null}>
        {activeBookmark ? (
          <div className="rotate-3 scale-105 opacity-90">
            <BookmarkCard bookmark={activeBookmark} onEdit={() => {}} onDelete={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </div>
    </DndContext>
  );
}
