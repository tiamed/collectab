import { useState, useRef, useEffect } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Search, Layers, Settings, LogOut, Plus, Pencil, Trash2, MoreHorizontal, ChevronDown, UserPlus } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import IconDisplay from './IconDisplay';
import type { Space, User, Organization } from '@/lib/api';

function SortableSpaceRow({
  space,
  activeSpaceId,
  editingSpaceId,
  editName,
  menuSpaceId,
  editInputRef,
  menuRef,
  canManage,
  onSelect,
  onStartRename,
  onDelete,
  onToggleMenu,
  onOpenSettings,
  onEditNameChange,
  onCommitRename,
  onEditKeyDown,
}: {
  space: Space;
  activeSpaceId: string | null;
  editingSpaceId: string | null;
  editName: string;
  menuSpaceId: string | null;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  canManage: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onToggleMenu: () => void;
  onOpenSettings: () => void;
  onEditNameChange: (v: string) => void;
  onCommitRename: () => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: space.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform ? { x: 0, y: transform.y, scaleX: 1, scaleY: 1 } : null),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  if (editingSpaceId === space.id) {
    return (
      <div ref={setNodeRef} style={style} className="group relative flex items-center">
        <div className="flex h-7 w-full items-center px-4">
          <input
            ref={editInputRef}
            className="w-full rounded bg-[var(--background)] px-1.5 py-0.5 text-xs text-[var(--foreground)] outline-none ring-1 ring-[var(--accent)]"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={onEditKeyDown}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="group relative flex items-center" {...attributes} {...listeners}>
      <button
        className={`flex h-7 w-full items-center gap-2 px-4 text-left transition-colors ${
          activeSpaceId === space.id
            ? 'bg-[var(--surface)] text-[var(--foreground)]'
            : 'text-[var(--muted)] hover:bg-[var(--surface)]'
        }`}
        title={space.isShared && space.ownerName ? `${space.name} (from ${space.ownerName})` : undefined}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <span className="flex size-3.5 items-center justify-center">
          <IconDisplay icon={space.icon} fallback="●" className="text-xs leading-none" imgClassName="size-3.5 rounded-sm object-contain" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">
          {space.name}
          {space.isShared && space.ownerName && (
            <span className="text-[var(--muted)]"> (from {space.ownerName})</span>
          )}
        </span>
      </button>
      {canManage && (
        <button
          className="absolute right-2 flex size-5 items-center justify-center rounded text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--surface)] hover:text-[var(--foreground)] group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}
      {canManage && menuSpaceId === space.id && (
        <div
          ref={menuRef}
          className="absolute right-2 top-6 z-50 min-w-[120px] rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--foreground)] hover:bg-[var(--background)]"
            onClick={(e) => { e.stopPropagation(); onStartRename(); }}
          >
            <Pencil className="size-3" />
            Rename
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--foreground)] hover:bg-[var(--background)]"
            onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
          >
            <Settings className="size-3" />
            Settings
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-[var(--background)]"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="size-3" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  orgs: Organization[];
  activeOrgId: string | null;
  personalName: string;
  onOrgSelect: (id: string) => void;
  onAddOrg: () => void;
  onRenameOrg: (id: string, currentName: string) => void;
  onRenamePersonal: () => void;
  onDeleteOrg: (id: string, name: string) => void;
  onOpenOrgSettings: (org: Organization) => void;
  onManageOrgMembers?: (org: Organization) => void;
  spaces: Space[];
  activeSpaceId: string | null;
  onSpaceSelect: (id: string) => void;
  onAddSpace: () => void;
  onRenameSpace: (id: string, name: string) => void;
  onDeleteSpace: (id: string) => void;
  onOpenSpaceSettings: (space: Space) => void;
  onReorderSpaces: (orderedIds: string[]) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenSettings: () => void;
  user: User;
  onAccountClick: () => void;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  /** Per-space: whether current user can rename/settings/delete */
  canManageSpace?: (space: Space) => boolean;
  /** Whether current user can create spaces in this org/personal */
  canCreateSpace?: boolean;
}

export default function Sidebar({
  orgs,
  activeOrgId,
  onOrgSelect,
  onAddOrg,
  onRenameOrg,
  onRenamePersonal,
  onDeleteOrg,
  onOpenOrgSettings,
  onManageOrgMembers,
  personalName,
  spaces,
  activeSpaceId,
  onSpaceSelect,
  onAddSpace,
  onRenameSpace,
  onDeleteSpace,
  onOpenSpaceSettings,
  onReorderSpaces,
  searchQuery,
  onSearchChange,
  onOpenSettings,
  user,
  onAccountClick,
  onLogout,
  theme,
  onToggleTheme,
  canManageSpace = () => true,
  canCreateSpace = true,
}: SidebarProps) {
  const activeOrg = orgs.find((o) => o.id === activeOrgId);
  const activeSpace = spaces.find((s) => s.id === activeSpaceId);
  const [showOrgDropdown, setShowOrgDropdown] = useState(false);
  const orgDropdownRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [orderedIds, setOrderedIds] = useState<string[]>(() => spaces.map((s) => s.id));

  useEffect(() => {
    setOrderedIds(spaces.map((s) => s.id));
  }, [spaces]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedIds.indexOf(active.id as string);
    const newIndex = orderedIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(orderedIds, oldIndex, newIndex);
    setOrderedIds(reordered);
    onReorderSpaces(reordered);
  }

  const orderedSpaces = orderedIds.map((id) => spaces.find((s) => s.id === id)).filter(Boolean) as Space[];
  const [menuSpaceId, setMenuSpaceId] = useState<string | null>(null);
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuSpaceId(null);
      }
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) {
        setShowOrgDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (editingSpaceId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingSpaceId]);

  const startRename = (space: Space) => {
    setEditingSpaceId(space.id);
    setEditName(space.name);
    setMenuSpaceId(null);
  };

  const commitRename = () => {
    if (editingSpaceId && editName.trim()) {
      onRenameSpace(editingSpaceId, editName.trim());
    }
    setEditingSpaceId(null);
  };

  const handleDelete = (id: string) => {
    setMenuSpaceId(null);
    onDeleteSpace(id);
  };

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--background)]">
      {/* Org Switcher */}
      <div className="relative px-3 pt-3 pb-1" ref={orgDropdownRef}>
        <button
          onClick={() => setShowOrgDropdown(!showOrgDropdown)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface)]"
        >
          <span className="flex size-4 items-center justify-center">
            {activeOrg ? (
              <IconDisplay icon={activeOrg.icon} className="text-sm leading-none" imgClassName="size-4 rounded-sm object-contain" />
            ) : (
              <Layers className="size-4 text-[var(--accent)]" strokeWidth={1.5} />
            )}
          </span>
          <span className="flex-1 truncate text-[13px] font-semibold text-[var(--foreground)]">
            {activeOrg?.name ?? personalName}
          </span>
          <ChevronDown className="size-3 text-[var(--muted)]" strokeWidth={2} />
        </button>

        {showOrgDropdown && (
          <div className="absolute left-3 right-3 top-12 z-50 rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl">
            <div className="group/personal flex items-center">
              <button
                className={`flex flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--background)] ${
                  !activeOrgId ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'
                }`}
                onClick={() => { onOrgSelect(''); setShowOrgDropdown(false); }}
              >
                <Layers className="size-3.5" strokeWidth={1.5} />
                {personalName}
              </button>
              <button
                className="flex size-5 shrink-0 items-center justify-center rounded pr-2 text-[var(--muted)] opacity-0 hover:text-[var(--foreground)] group-hover/personal:opacity-100"
                onClick={(e) => { e.stopPropagation(); setShowOrgDropdown(false); onRenamePersonal(); }}
                title="Rename"
              >
                <Pencil className="size-2.5" />
              </button>
            </div>
            {orgs.map((org) => (
              <div key={org.id} className="group/org flex items-center">
                <button
                  className={`flex flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--background)] ${
                    activeOrgId === org.id ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'
                  }`}
                  onClick={() => { onOrgSelect(org.id); setShowOrgDropdown(false); }}
                >
                  <span className="flex size-3.5 items-center justify-center">
                    <IconDisplay icon={org.icon} className="text-xs leading-none" imgClassName="size-3.5 rounded-sm object-contain" />
                  </span>
                  <span className="flex-1 truncate">{org.name}</span>
                  <span className="text-[9px] text-[var(--muted)]">{org.role}</span>
                </button>
                {(org.role === 'owner' || org.role === 'admin') && (
                  <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-0 group-hover/org:opacity-100">
                    {onManageOrgMembers && (
                      <button
                        className="flex size-5 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--foreground)]"
                        onClick={(e) => { e.stopPropagation(); setShowOrgDropdown(false); onManageOrgMembers(org); }}
                        title="Manage members"
                      >
                        <UserPlus className="size-2.5" />
                      </button>
                    )}
                    {org.role === 'owner' && (
                      <>
                        <button
                          className="flex size-5 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--foreground)]"
                          onClick={(e) => { e.stopPropagation(); setShowOrgDropdown(false); onOpenOrgSettings(org); }}
                          title="Settings"
                        >
                          <Settings className="size-2.5" />
                        </button>
                        <button
                          className="flex size-5 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--foreground)]"
                          onClick={(e) => { e.stopPropagation(); setShowOrgDropdown(false); onRenameOrg(org.id, org.name); }}
                          title="Rename"
                        >
                          <Pencil className="size-2.5" />
                        </button>
                        <button
                          className="flex size-5 items-center justify-center rounded text-[var(--muted)] hover:text-red-400"
                          onClick={(e) => { e.stopPropagation(); setShowOrgDropdown(false); onDeleteOrg(org.id, org.name); }}
                          title="Delete"
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="my-1 h-px bg-[var(--border)]" />
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              onClick={() => { onAddOrg(); setShowOrgDropdown(false); }}
            >
              <Plus className="size-3" strokeWidth={2} />
              New Organization
            </button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="flex h-9 items-center gap-2 px-4">
        <Search className="size-[14px] text-[var(--muted)]" strokeWidth={1.5} />
        <input
          type="text"
          placeholder="Search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-full flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
        />
      </div>

      {/* Divider */}
      <div className="px-4 py-2">
        <div className="h-px bg-[var(--border)]" />
      </div>

      {/* Spaces label + add button */}
      <div className="flex h-8 items-center justify-between px-4">
        <span className="text-[11px] font-semibold text-[var(--muted)]">Spaces</span>
        {canCreateSpace && (
          <button
            onClick={onAddSpace}
            className="flex size-5 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            title="Add space"
          >
            <Plus className="size-3" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Space list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <nav className="flex-1 overflow-y-auto overflow-x-hidden">
            {orderedSpaces.map((space) => (
              <SortableSpaceRow
                key={space.id}
                space={space}
                activeSpaceId={activeSpaceId}
                editingSpaceId={editingSpaceId}
                editName={editName}
                menuSpaceId={menuSpaceId}
                editInputRef={editInputRef}
                menuRef={menuRef}
                canManage={canManageSpace(space)}
                onSelect={() => onSpaceSelect(space.id)}
                onStartRename={() => startRename(space)}
                onDelete={() => handleDelete(space.id)}
                onToggleMenu={() => setMenuSpaceId(menuSpaceId === space.id ? null : space.id)}
                onOpenSettings={() => { setMenuSpaceId(null); onOpenSpaceSettings(space); }}
                onEditNameChange={setEditName}
                onCommitRename={commitRename}
                onEditKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingSpaceId(null);
                }}
              />
            ))}
          </nav>
        </SortableContext>
      </DndContext>

      {/* Bottom */}
      <div className="space-y-0 border-t border-[var(--border)]">
        <div className="flex h-7 items-center justify-between px-4">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <Settings className="size-[14px]" strokeWidth={1.5} />
            <span className="text-xs">Settings</span>
          </button>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>

        {/* Account row */}
        <div className="flex h-9 items-center justify-between px-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-bold text-white">
              {user.name[0]?.toUpperCase()}
            </div>
            <span className="truncate text-xs text-[var(--foreground)]">{user.name}</span>
          </div>
          <button
            onClick={onLogout}
            className="flex size-5 items-center justify-center rounded text-[var(--muted)] hover:text-red-400"
            title="Sign out"
          >
            <LogOut className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  );
}
