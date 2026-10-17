import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import Toolbar from '@/components/Toolbar';
import ContentArea from '@/components/ContentArea';
import SettingsModal from '@/components/SettingsModal';
import OrgSettingsModal from '@/components/OrgSettingsModal';
import SpaceSettingsModal from '@/components/SpaceSettingsModal';
import CollectionSettingsModal from '@/components/CollectionSettingsModal';
import AuthModal from '@/components/AuthModal';
import MembersModal from '@/components/MembersModal';
import SortCollectionsModal from '@/components/SortCollectionsModal';
import PromptModal from '@/components/PromptModal';
import ConfirmModal from '@/components/ConfirmModal';
import DeleteOrgModal from '@/components/DeleteOrgModal';
import { useOrganizations, useSpaces, useCollections, useCollectionBookmarks } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTheme } from '@/hooks/useTheme';
import { loadApiBase, isLoggedIn, createCollection, createSpace, createOrganization, updateOrganization, deleteOrganization, updateSpace, deleteSpace, deleteAllSpaces, updateCollection, deleteCollection } from '@/lib/api';
import type { Bookmark, User, Organization, Space, Collection } from '@/lib/api';
import { CrdtOrderManager } from '@/lib/crdt-order-mgr';
import { CrdtSyncClient } from '@/lib/crdt-sync-port';
import { collectCrdtIds, diffRemovedIds, reconcileCrdtOrder } from '@/lib/crdt-reconcile';
import { ensureDataCacheLoaded, getCachedUser } from '@/lib/dataCache';

const STORAGE_KEY_ORG = 'active_org_id';
const STORAGE_KEY_SPACE = 'active_space_id';
const STORAGE_KEY_PERSONAL_NAME = 'personal_org_name';

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootUser, setBootUser] = useState<User | null>(null);
  const [activeOrgId, setActiveOrgIdRaw] = useState<string | null>(null);
  const [activeSpaceId, setActiveSpaceIdRaw] = useState<string | null>(null);

  const setActiveOrgId = (id: string | null) => {
    setActiveOrgIdRaw(id);
    if (id) browser.storage.local.set({ [STORAGE_KEY_ORG]: id });
    else browser.storage.local.remove(STORAGE_KEY_ORG);
  };

  const setActiveSpaceId = (id: string | null) => {
    setActiveSpaceIdRaw(id);
    if (id) browser.storage.local.set({ [STORAGE_KEY_SPACE]: id });
    else browser.storage.local.remove(STORAGE_KEY_SPACE);
  };
  const [personalName, setPersonalNameRaw] = useState('Personal');

  const setPersonalName = (name: string) => {
    setPersonalNameRaw(name);
    browser.storage.local.set({ [STORAGE_KEY_PERSONAL_NAME]: name });
  };

  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [allCollapsed, setAllCollapsed] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [membersModal, setMembersModal] = useState<
    | { type: 'space' }
    | { type: 'org'; orgId: string; orgName: string }
    | null
  >(null);
  const [showSortCollections, setShowSortCollections] = useState(false);
  const [orgSettingsTarget, setOrgSettingsTarget] = useState<Organization | null>(null);
  const [spaceSettingsTarget, setSpaceSettingsTarget] = useState<Space | null>(null);
  const [collectionSettingsTarget, setCollectionSettingsTarget] = useState<Collection | null>(null);

  // Prompt modal state
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptConfig, setPromptConfig] = useState<{ title: string; label?: string; placeholder?: string; defaultValue?: string }>({ title: '' });
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);

  const openPrompt = useCallback((config: typeof promptConfig): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptConfig(config);
      promptResolveRef.current = resolve;
      setPromptOpen(true);
    });
  }, []);

  // Confirm modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; confirmLabel?: string }>({ title: '', message: '' });
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

  const openConfirm = useCallback((config: typeof confirmConfig): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmConfig(config);
      confirmResolveRef.current = resolve;
      setConfirmOpen(true);
    });
  }, []);

  useEffect(() => {
    Promise.all([
      loadApiBase(),
      ensureDataCacheLoaded(),
      browser.storage.local.get([STORAGE_KEY_ORG, STORAGE_KEY_SPACE, STORAGE_KEY_PERSONAL_NAME]),
    ]).then(([, , stored]) => {
      const s = stored as Record<string, string | undefined>;
      if (s[STORAGE_KEY_ORG]) setActiveOrgIdRaw(s[STORAGE_KEY_ORG] as string);
      if (s[STORAGE_KEY_SPACE]) setActiveSpaceIdRaw(s[STORAGE_KEY_SPACE] as string);
      if (s[STORAGE_KEY_PERSONAL_NAME]) setPersonalNameRaw(s[STORAGE_KEY_PERSONAL_NAME] as string);
      if (isLoggedIn()) setBootUser(getCachedUser());
      setReady(true);
    });
  }, []);

  const { user, loading: authLoading, login, register, loginWithGoogle, logout } = useAuth(ready, bootUser);
  const { theme, toggle: toggleTheme } = useTheme();
  const { browserOnline, available } = useOnlineStatus();

  const sessionUser = user ?? bootUser;
  const loggedIn = !!sessionUser;
  const { orgs, loading: orgsLoading, refetch: refetchOrgs } = useOrganizations(loggedIn);
  const { spaces, loading: spacesLoading, refetch: refetchSpaces } = useSpaces(activeOrgId, loggedIn);
  const { collections, loading: colsLoading, refetch: refetchCollections } = useCollections(activeSpaceId, loggedIn);

  // Auto-select a space only after spaces have loaded — never wipe a
  // restored selection while the list is still empty/loading.
  useEffect(() => {
    if (spacesLoading) return;
    if (spaces.length > 0) {
      if (!activeSpaceId || !spaces.find((s) => s.id === activeSpaceId)) {
        setActiveSpaceId(spaces[0].id);
      }
    } else if (activeSpaceId) {
      setActiveSpaceId(null);
    }
  }, [spaces, spacesLoading, activeSpaceId]);

  const collectionIds = useMemo(() => collections.map((c) => c.id), [collections]);
  const {
    data: bookmarksByCollection,
    loading: bksLoading,
    update,
    remove,
    add,
    reorder,
    reorderLocal,
    refetch: refetchBookmarks,
  } = useCollectionBookmarks(activeSpaceId);

  const crdtOrderRef = useRef<CrdtOrderManager | null>(null);
  const bookmarksRef = useRef(bookmarksByCollection);
  const collectionsRef = useRef(collections);
  const wasUnavailableRef = useRef(false);
  bookmarksRef.current = bookmarksByCollection;
  collectionsRef.current = collections;

  // IDs a remote tab removed from the CRDT entirely (diffed per WS update).
  // Without this, stale REST data would make a remotely deleted bookmark look
  // "new" here and it would get re-added.
  const removedIdsRef = useRef<Set<string>>(new Set());

  const applyCrdtOrderToUi = useCallback((mgr: CrdtOrderManager) => {
    const cols = collectionsRef.current;
    const bks = bookmarksRef.current;
    const colIds = new Set(cols.map((c) => c.id));
    const bkKeys = Object.keys(bks);
    // Space switch can leave collections from B and bookmarks from A in refs
    // for a tick; reconciling that against the new CRDT snapshot writes empty
    // lists into the new space and flashes the UI.
    if (bkKeys.length > 0 && !bkKeys.some((k) => colIds.has(k))) return;

    const reconciled = reconcileCrdtOrder(
      mgr,
      cols,
      bks,
      removedIdsRef.current,
    );
    for (const [colId, merged] of Object.entries(reconciled)) {
      reorderLocal(colId, merged);
    }
  }, [reorderLocal]);

  // CRDT WS lives in the newtab page (not MV3 SW) — Port to background often fails with
  // "Receiving end does not exist" when the service worker is asleep/unloaded.
  useEffect(() => {
    if (!activeSpaceId || !loggedIn || !available) return;

    const mgr = new CrdtOrderManager();
    const client = new CrdtSyncClient();
    crdtOrderRef.current = mgr;
    removedIdsRef.current = new Set();

    mgr.init(activeSpaceId, (updateBytes) => {
      client.send(updateBytes);
    });

    client.connect(activeSpaceId, (updateBytes) => {
      if (!mgr.isReady) {
        mgr.bootstrapWithSnapshot(updateBytes);
      } else {
        const before = collectCrdtIds(mgr, collectionsRef.current);
        mgr.applyRemoteUpdate(updateBytes);
        const after = collectCrdtIds(mgr, collectionsRef.current);
        // IDs gone from every CRDT list were deleted by a remote tab.
        for (const id of diffRemovedIds(before, after)) {
          removedIdsRef.current.add(id);
        }
      }
      if (mgr.isReady) applyCrdtOrderToUi(mgr);
    });

    return () => {
      mgr.destroy();
      client.disconnect();
      crdtOrderRef.current = null;
    };
  }, [activeSpaceId, loggedIn, available, applyCrdtOrderToUi]);

  useEffect(() => {
    if (!available) {
      wasUnavailableRef.current = true;
      return;
    }
    if (!wasUnavailableRef.current || !loggedIn) return;
    wasUnavailableRef.current = false;
    void refetchOrgs();
    void refetchSpaces();
    void refetchCollections();
    void refetchBookmarks();
  }, [available, loggedIn, refetchOrgs, refetchSpaces, refetchCollections, refetchBookmarks]);

  // REST bootstrap only after bookmarks are loaded (avoid empty CRDT lists that break move()).
  useEffect(() => {
    if (!activeSpaceId || !loggedIn || bksLoading) return;
    const mgr = crdtOrderRef.current;
    if (!mgr || mgr.isReady) return;

    const timeoutId = setTimeout(() => {
      if (mgr.isReady) return;
      const restData: Record<string, string[]> = {};
      for (const col of collectionsRef.current) {
        restData[col.id] = (bookmarksRef.current[col.id] || []).map((b) => b.id);
      }
      mgr.bootstrapFromREST(restData);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [activeSpaceId, loggedIn, bksLoading, collectionIds, bookmarksByCollection]);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId);
  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  // Space-level role from GET /spaces. Org membership alone is not enough.
  const mySpaceRole = activeSpace?.myRole
    ?? (activeSpace?.ownerId === sessionUser?.id || activeOrg?.role === 'owner' ? 'owner' : null);
  const isSpaceOwner = mySpaceRole === 'owner';
  const canEditContent = mySpaceRole === 'owner' || mySpaceRole === 'editor';
  // TopBar manages space members — space owners only (org or personal)
  const canManageSpaceMembers = isSpaceOwner;
  const canManageSpace = isSpaceOwner;
  const canChangeOrgRoles = activeOrg?.role === 'owner';
  const canCreateSpace = !activeOrgId || activeOrg?.role === 'owner' || activeOrg?.role === 'admin';
  const canManageSpaceFn = (space: Space) =>
    space.myRole === 'owner' || space.ownerId === sessionUser?.id || activeOrg?.role === 'owner';

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const bks of Object.values(bookmarksByCollection)) {
      for (const b of bks) {
        b.tags?.forEach((t) => tags.add(t));
      }
    }
    return Array.from(tags).sort();
  }, [bookmarksByCollection]);

  const filteredBookmarks = useMemo(() => {
    const result: Record<string, Bookmark[]> = {};
    for (const [colId, bks] of Object.entries(bookmarksByCollection)) {
      let filtered = bks;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.url.toLowerCase().includes(q) ||
            (b.description?.toLowerCase().includes(q)),
        );
      }
      if (tagFilter) {
        filtered = filtered.filter((b) => b.tags?.includes(tagFilter));
      }
      result[colId] = filtered;
    }
    return result;
  }, [bookmarksByCollection, searchQuery, tagFilter]);

  const handleAddCollection = useCallback(async () => {
    if (!activeSpaceId) return;
    const name = await openPrompt({ title: 'New Collection', label: 'Name', placeholder: 'Collection name' });
    if (!name) return;
    await createCollection(activeSpaceId, name);
    refetchCollections();
  }, [activeSpaceId, refetchCollections, openPrompt]);

  const handleAddSpace = useCallback(async () => {
    const name = await openPrompt({ title: 'New Space', label: 'Name', placeholder: 'Space name' });
    if (!name) return;
    await createSpace(name, undefined, activeOrgId);
    refetchSpaces();
  }, [activeOrgId, refetchSpaces, openPrompt]);

  const handleAddOrg = useCallback(async () => {
    const name = await openPrompt({ title: 'New Organization', label: 'Name', placeholder: 'Organization name' });
    if (!name) return;
    const org = await createOrganization(name);
    refetchOrgs();
    setActiveOrgId(org.id);
    setActiveSpaceId(null);
  }, [refetchOrgs, openPrompt]);

  const handleRenameOrg = useCallback(async (id: string, currentName: string) => {
    const name = await openPrompt({ title: 'Rename Organization', label: 'Name', placeholder: 'Organization name', defaultValue: currentName });
    if (!name || name === currentName) return;
    await updateOrganization(id, { name });
    refetchOrgs();
  }, [refetchOrgs, openPrompt]);

  const handleRenamePersonal = useCallback(async () => {
    const name = await openPrompt({ title: 'Rename Personal Space', label: 'Name', placeholder: 'Personal', defaultValue: personalName });
    if (!name || name === personalName) return;
    setPersonalName(name);
  }, [personalName, openPrompt]);

  const [deleteOrgTarget, setDeleteOrgTarget] = useState<{ id: string; name: string } | null>(null);

  const handleDeleteOrg = useCallback(async () => {
    if (!deleteOrgTarget) return;
    await deleteOrganization(deleteOrgTarget.id);
    if (activeOrgId === deleteOrgTarget.id) {
      setActiveOrgId(null);
      setActiveSpaceId(null);
    }
    setDeleteOrgTarget(null);
    refetchOrgs();
  }, [deleteOrgTarget, activeOrgId, refetchOrgs]);

  const handleReorderSpaces = useCallback(async (orderedIds: string[]) => {
    await Promise.all(orderedIds.map((id, i) => updateSpace(id, { orderIndex: i })));
    refetchSpaces();
  }, [refetchSpaces]);

  const handleReorderCollections = useCallback(async (orderedIds: string[]) => {
    await Promise.all(orderedIds.map((id, i) => updateCollection(id, { orderIndex: i })));
    refetchCollections();
  }, [refetchCollections]);

  const handleOpenSortCollections = useCallback(() => {
    setShowSortCollections(true);
    void refetchCollections();
  }, [refetchCollections]);

  const handleRenameSpace = useCallback(async (id: string, name: string) => {
    await updateSpace(id, { name });
    refetchSpaces();
  }, [refetchSpaces]);

  const handleDeleteSpace = useCallback(async (id: string) => {
    const confirmed = await openConfirm({ title: 'Delete Space', message: 'Delete this space and all its collections? This cannot be undone.', confirmLabel: 'Delete' });
    if (!confirmed) return;
    await deleteSpace(id);
    if (activeSpaceId === id) {
      setActiveSpaceId(null);
    }
    refetchSpaces();
  }, [activeSpaceId, refetchSpaces, openConfirm]);

  const handleRenameCollection = useCallback(async (id: string, name: string) => {
    await updateCollection(id, { name });
    refetchCollections();
  }, [refetchCollections]);

  const handleDeleteCollection = useCallback(async (id: string) => {
    const confirmed = await openConfirm({ title: 'Delete Collection', message: 'Delete this collection and all its bookmarks? This cannot be undone.', confirmLabel: 'Delete' });
    if (!confirmed) return;
    await deleteCollection(id);
    refetchCollections();
  }, [refetchCollections, openConfirm]);

  const handleSaveOrgSettings = useCallback(async (updates: { name?: string; icon?: string }) => {
    if (!orgSettingsTarget) return;
    await updateOrganization(orgSettingsTarget.id, updates);
    refetchOrgs();
  }, [orgSettingsTarget, refetchOrgs]);

  const handleSaveSpaceSettings = useCallback(async (updates: { name?: string; icon?: string }) => {
    if (!spaceSettingsTarget) return;
    await updateSpace(spaceSettingsTarget.id, updates);
    refetchSpaces();
  }, [spaceSettingsTarget, refetchSpaces]);

  const handleSaveCollectionSettings = useCallback(async (updates: { name?: string; icon?: string }) => {
    if (!collectionSettingsTarget) return;
    await updateCollection(collectionSettingsTarget.id, updates);
    refetchCollections();
  }, [collectionSettingsTarget, refetchCollections]);

  const handleCollectionReorder = useCallback((
    collectionId: string,
    orderedBookmarks: Bookmark[],
    meta: { bookmarkId: string; fromIndex: number; toIndex: number },
  ) => {
    reorderLocal(collectionId, orderedBookmarks);
    const mgr = crdtOrderRef.current;
    if (mgr?.isReady) {
      mgr.move(collectionId, meta.bookmarkId, meta.fromIndex, meta.toIndex);
    } else {
      // Persist via REST until CRDT is ready (WS snapshot / REST bootstrap).
      void reorder(collectionId, orderedBookmarks);
    }
  }, [reorderLocal, reorder]);

  const handleTransferBookmark = useCallback(async (
    bookmarkId: string,
    fromCollectionId: string,
    targetCollectionId: string,
    newIndex: number,
  ) => {
    const mgr = crdtOrderRef.current;
    const allBookmarks = Object.values(bookmarksRef.current).flat();
    const byId = new Map(allBookmarks.map((b) => [b.id, b]));

    if (mgr?.isReady) {
      try {
        const srcIds = mgr.getOrderedIds(fromCollectionId);
        const from = srcIds.indexOf(bookmarkId);
        if (from !== -1) {
          mgr.moveAcross(bookmarkId, fromCollectionId, from, targetCollectionId, newIndex);
        }
      } catch {
        // CRDT move failed (e.g. Loro insert bounds) — fall through so the
        // REST ownership update below still persists the transfer.
      }
    }

    try {
      // Persist collectionId ownership via REST so DB lookups keep X in the target.
      await update(bookmarkId, { collectionId: targetCollectionId });
    } catch {
      // noop - DnD state already reflects the change
    }

    try {
      // Renumber the whole target collection so orderIndex has no duplicates
      // (same guarantee the in-collection /reorder path gives on refresh).
      let ordered: Bookmark[] | null = null;
      if (mgr?.isReady) {
        const ids = mgr.getOrderedIds(targetCollectionId);
        if (ids.length > 0) {
          ordered = ids
            .map((id) => byId.get(id))
            .filter((b): b is Bookmark => Boolean(b));
        }
      } else {
        const targetList = bookmarksRef.current[targetCollectionId] || [];
        const moved = byId.get(bookmarkId);
        if (moved) {
          const withoutMoved = targetList.filter((b) => b.id !== bookmarkId);
          const idx = Math.max(0, Math.min(newIndex, withoutMoved.length));
          ordered = [...withoutMoved.slice(0, idx), moved, ...withoutMoved.slice(idx)];
        }
      }
      if (ordered && ordered.length > 0) {
        await reorder(targetCollectionId, ordered);
      }
    } catch {
      // noop - CRDT is the ordering authority; REST persistence is best-effort
    }
  }, [update, reorder]);

  const handleUpdateBookmark = useCallback(async (
    id: string,
    updates: Partial<Bookmark>,
  ): Promise<Bookmark> => {
    let srcCol: string | null = null;
    for (const [colId, bks] of Object.entries(bookmarksByCollection)) {
      if (bks.some((b) => b.id === id)) {
        srcCol = colId;
        break;
      }
    }
    const dstCol = updates.collectionId ?? null;
    const isMove = !!srcCol && !!dstCol && srcCol !== dstCol;

    const clean: Parameters<typeof update>[1] = {
      title: updates.title,
      url: updates.url,
      description: updates.description ?? undefined,
      favicon: updates.favicon ?? undefined,
      tags: updates.tags,
      collectionId: updates.collectionId,
    };

    if (isMove) {
      const mgr = crdtOrderRef.current;
      if (mgr?.isReady) {
        const srcIds = mgr.getOrderedIds(srcCol!);
        const from = srcIds.indexOf(id);
        if (from !== -1) {
          const toIndex = mgr.getOrderedIds(dstCol!).length;
          mgr.moveAcross(id, srcCol!, from, dstCol!, toIndex);
          clean.orderIndex = toIndex;
        }
      }
    }

    return update(id, clean);
  }, [update, bookmarksByCollection]);

  const handleAddBookmark = useCallback(async (params: {
    collectionId: string;
    title: string;
    url: string;
    description?: string;
    favicon?: string;
    tags?: string[];
  }) => {
    const bookmark = await add(params);
    crdtOrderRef.current?.addToEnd(params.collectionId, bookmark.id);
    return bookmark;
  }, [add]);

  const handleDeleteBookmark = useCallback(async (id: string) => {
    let collectionId: string | null = null;
    for (const [colId, bks] of Object.entries(bookmarksByCollection)) {
      if (bks.some((b) => b.id === id)) {
        collectionId = colId;
        break;
      }
    }
    await remove(id);
    if (collectionId) crdtOrderRef.current?.remove(collectionId, id);
  }, [remove, bookmarksByCollection]);

  const handleDeleteAllSpaces = useCallback(async () => {
    await deleteAllSpaces(activeOrgId);
    setActiveSpaceId(null);
    refetchSpaces();
  }, [activeOrgId, refetchSpaces]);

  const handleLogout = useCallback(async () => {
    await logout();
    window.location.reload();
  }, [logout]);

  const handleImportDone = useCallback(() => {
    refetchOrgs();
    refetchSpaces();
    setActiveSpaceId(null);
  }, [refetchOrgs, refetchSpaces]);

  if (!ready || (authLoading && !sessionUser)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[var(--background)]">
        <span className="text-sm text-[var(--muted)]">Loading...</span>
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-[var(--background)]">
        <div className="text-center">
          <h1 className="mb-2 text-lg font-semibold text-[var(--foreground)]">Collectab</h1>
          <p className="mb-4 text-xs text-[var(--muted)]">Sign in to access your bookmarks</p>
        </div>
        <button
          onClick={() => setShowAuth(true)}
          className="rounded bg-[var(--accent)] px-6 py-2 text-sm font-medium text-white"
        >
          Sign In / Register
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          Configure server URL
        </button>

        {showAuth && (
          <AuthModal onClose={() => setShowAuth(false)} onLogin={login} onRegister={register} onLoginWithGoogle={loginWithGoogle} />
        )}
        {showSettings && (
          <SettingsModal
            onClose={() => setShowSettings(false)}
            onImportDone={handleImportDone}
            onServerChanged={() => { window.location.reload(); }}
            activeOrgId={activeOrgId}
            user={user}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col bg-[var(--background)]">
      {loggedIn && !available && (
        <div
          role="status"
          className="shrink-0 border-b border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-center text-[11px] leading-tight text-[var(--muted)]"
        >
          {browserOnline
            ? "Can't reach server — showing cached data. Changes won't save until the server is back"
            : "Offline — showing cached data. Changes won't save until you're back online"}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <Sidebar
        orgs={orgs}
        activeOrgId={activeOrgId}
        personalName={personalName}
        onOrgSelect={(id) => { setActiveOrgId(id || null); setActiveSpaceId(null); }}
        onAddOrg={handleAddOrg}
        onRenameOrg={handleRenameOrg}
        onRenamePersonal={handleRenamePersonal}
        onDeleteOrg={(id, name) => setDeleteOrgTarget({ id, name })}
        onOpenOrgSettings={setOrgSettingsTarget}
        onManageOrgMembers={(org) => setMembersModal({ type: 'org', orgId: org.id, orgName: org.name })}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSpaceSelect={setActiveSpaceId}
        onAddSpace={handleAddSpace}
        onRenameSpace={handleRenameSpace}
        onDeleteSpace={handleDeleteSpace}
        onOpenSpaceSettings={setSpaceSettingsTarget}
        onReorderSpaces={handleReorderSpaces}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenSettings={() => setShowSettings(true)}
        user={sessionUser}
        onAccountClick={() => setShowAuth(true)}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={toggleTheme}
        canManageSpace={canManageSpaceFn}
        canCreateSpace={canCreateSpace}
      />
      <main className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          spaceName={activeSpace?.name ?? ''}
          collectionCount={collections.length}
          onAddCollection={handleAddCollection}
          onSortCollections={handleOpenSortCollections}
          onOpenSettings={() => {
            const space = spaces.find((s) => s.id === activeSpaceId);
            if (space) setSpaceSettingsTarget(space);
            else setShowSettings(true);
          }}
          onManageMembers={() => setMembersModal({ type: 'space' })}
          canEditContent={canEditContent}
          canManageMembers={canManageSpaceMembers}
          canManageSpace={canManageSpace}
        />
        <Toolbar
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          allTags={allTags}
          onExpandAll={() => setAllCollapsed(false)}
          onCollapseAll={() => setAllCollapsed(true)}
        />
        <ContentArea
          spaceId={activeSpaceId}
          collections={collections}
          bookmarksByCollection={filteredBookmarks}
          loading={colsLoading || bksLoading}
          onUpdateBookmark={handleUpdateBookmark}
          onDeleteBookmark={handleDeleteBookmark}
          onAddBookmark={handleAddBookmark}
          onRenameCollection={handleRenameCollection}
          onDeleteCollection={handleDeleteCollection}
          onOpenCollectionSettings={setCollectionSettingsTarget}
          onCollectionReorder={handleCollectionReorder}
          onTransferBookmark={handleTransferBookmark}
          allCollapsed={allCollapsed}
          onResetCollapsed={() => setAllCollapsed(null)}
          canEditContent={canEditContent}
        />
      </main>
      </div>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onImportDone={handleImportDone}
          onServerChanged={() => { window.location.reload(); }}
          activeOrgId={activeOrgId}
          activeOrgName={orgs.find((o) => o.id === activeOrgId)?.name ?? personalName}
          onDeleteAllSpaces={handleDeleteAllSpaces}
        />
      )}
      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} onLogin={login} onRegister={register} onLoginWithGoogle={loginWithGoogle} />
      )}
      {membersModal?.type === 'space' && (
        <MembersModal
          spaceId={activeSpaceId}
          spaceName={activeSpace?.name ?? ''}
          isOrgSpace={!!activeOrgId}
          parentOrgId={activeOrgId}
          parentOrgName={activeOrg?.name}
          canAddOrgMembers={activeOrg?.role === 'owner' || activeOrg?.role === 'admin'}
          onOpenOrgMembers={
            activeOrg
              ? () => setMembersModal({ type: 'org', orgId: activeOrg.id, orgName: activeOrg.name })
              : undefined
          }
          onClose={() => setMembersModal(null)}
          canChangeRoles
        />
      )}
      {membersModal?.type === 'org' && (
        <MembersModal
          orgId={membersModal.orgId}
          orgName={membersModal.orgName}
          spaceId={null}
          spaceName=""
          onClose={() => setMembersModal(null)}
          canChangeRoles={canChangeOrgRoles}
        />
      )}

      {showSortCollections && (
        <SortCollectionsModal
          collections={collections}
          loading={colsLoading}
          onReorder={handleReorderCollections}
          onClose={() => setShowSortCollections(false)}
        />
      )}

      {orgSettingsTarget && (
        <OrgSettingsModal
          org={orgSettingsTarget}
          onSave={handleSaveOrgSettings}
          onClose={() => setOrgSettingsTarget(null)}
        />
      )}
      {spaceSettingsTarget && (
        <SpaceSettingsModal
          space={spaceSettingsTarget}
          onSave={handleSaveSpaceSettings}
          onClose={() => setSpaceSettingsTarget(null)}
        />
      )}
      {collectionSettingsTarget && (
        <CollectionSettingsModal
          collection={collectionSettingsTarget}
          onSave={handleSaveCollectionSettings}
          onClose={() => setCollectionSettingsTarget(null)}
        />
      )}

      <PromptModal
        isOpen={promptOpen}
        title={promptConfig.title}
        label={promptConfig.label}
        placeholder={promptConfig.placeholder}
        defaultValue={promptConfig.defaultValue}
        onSubmit={(value) => {
          promptResolveRef.current?.(value);
          promptResolveRef.current = null;
          setPromptOpen(false);
        }}
        onClose={() => {
          promptResolveRef.current?.(null);
          promptResolveRef.current = null;
          setPromptOpen(false);
        }}
      />

      <ConfirmModal
        isOpen={confirmOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        confirmLabel={confirmConfig.confirmLabel}
        onConfirm={() => {
          confirmResolveRef.current?.(true);
          confirmResolveRef.current = null;
          setConfirmOpen(false);
        }}
        onClose={() => {
          confirmResolveRef.current?.(false);
          confirmResolveRef.current = null;
          setConfirmOpen(false);
        }}
      />

      <DeleteOrgModal
        isOpen={!!deleteOrgTarget}
        orgName={deleteOrgTarget?.name ?? ''}
        onConfirm={handleDeleteOrg}
        onClose={() => setDeleteOrgTarget(null)}
      />
    </div>
  );
}
