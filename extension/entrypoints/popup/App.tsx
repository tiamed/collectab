import { useState, useEffect } from 'react';
import { Bookmark, Check, ChevronDown, Layers } from 'lucide-react';
import {
  loadApiBase,
  getSpaces,
  getCollections,
  createBookmark,
  getOrganizations,
  type Space,
  type Collection,
  type Organization,
} from '@/lib/api';
import FaviconField from '@/components/FaviconField';
import { resolveFaviconUrl } from '@/lib/favicon';
import { notifyBookmarksChanged } from '@/lib/bookmarksSync';

const STORAGE_KEY_ORG = 'active_org_id';
const STORAGE_KEY_LAST_SPACE = 'popup_last_space';
const STORAGE_KEY_LAST_COLLECTION = 'popup_last_collection';

export default function App() {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [favicon, setFavicon] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    try {
      await loadApiBase();

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const pageUrl = tab.url || '';
        const pageTitle = tab.title || '';
        setTitle(pageTitle);
        setUrl(pageUrl);
        const tabIcon = tab.favIconUrl || '';
        setFavicon(tabIcon);
        // Prefer a CDN icon when the tab icon is missing/broken (e.g. CORP-restricted)
        if (pageUrl) {
          void resolveFaviconUrl(pageUrl, tabIcon).then((resolved) => {
            if (resolved) setFavicon(resolved);
          });
        }
      }

      const stored = (await browser.storage.local.get([
        STORAGE_KEY_ORG,
        STORAGE_KEY_LAST_SPACE,
        STORAGE_KEY_LAST_COLLECTION,
      ])) as Record<string, string | undefined>;
      const orgId = (stored[STORAGE_KEY_ORG] as string | undefined) || null;
      setSelectedOrgId(orgId);

      const [fetchedOrgs, fetchedSpaces] = await Promise.all([
        getOrganizations().catch(() => []),
        getSpaces(orgId).catch(() => []),
      ]);
      setOrgs(fetchedOrgs);
      setSpaces(fetchedSpaces);

      if (fetchedSpaces.length > 0) {
        const lastSpaceId = stored[STORAGE_KEY_LAST_SPACE];
        const spaceId =
          lastSpaceId && fetchedSpaces.some((s) => s.id === lastSpaceId)
            ? lastSpaceId
            : fetchedSpaces[0].id;
        setSelectedSpaceId(spaceId);
        const cols = await getCollections(spaceId).catch(() => []);
        setCollections(cols);

        const lastCol = stored[STORAGE_KEY_LAST_COLLECTION];
        if (lastCol && cols.some((c) => c.id === lastCol)) {
          setSelectedCollectionId(lastCol);
        } else if (cols.length > 0) {
          setSelectedCollectionId(cols[0].id);
        }
      }
    } catch {
      setError('Failed to load data. Check login status.');
    } finally {
      setLoading(false);
    }
  }

  async function handleOrgChange(orgId: string) {
    const id = orgId || null;
    setSelectedOrgId(id);
    setSelectedSpaceId(null);
    setSelectedCollectionId(null);
    setCollections([]);

    if (id) await browser.storage.local.set({ [STORAGE_KEY_ORG]: id });
    else await browser.storage.local.remove(STORAGE_KEY_ORG);

    const fetchedSpaces = await getSpaces(id).catch(() => []);
    setSpaces(fetchedSpaces);
    if (fetchedSpaces.length > 0) {
      const stored = (await browser.storage.local.get([
        STORAGE_KEY_LAST_SPACE,
        STORAGE_KEY_LAST_COLLECTION,
      ])) as Record<string, string | undefined>;
      const lastSpaceId = stored[STORAGE_KEY_LAST_SPACE] as string | undefined;
      const spaceId =
        lastSpaceId && fetchedSpaces.some((s) => s.id === lastSpaceId)
          ? lastSpaceId
          : fetchedSpaces[0].id;
      setSelectedSpaceId(spaceId);
      const cols = await getCollections(spaceId).catch(() => []);
      setCollections(cols);
      const lastCol = stored[STORAGE_KEY_LAST_COLLECTION] as string | undefined;
      if (lastCol && cols.some((c) => c.id === lastCol)) {
        setSelectedCollectionId(lastCol);
      } else if (cols.length > 0) {
        setSelectedCollectionId(cols[0].id);
      }
    }
  }

  async function handleSpaceChange(spaceId: string) {
    setSelectedSpaceId(spaceId);
    setSelectedCollectionId(null);
    await browser.storage.local.set({ [STORAGE_KEY_LAST_SPACE]: spaceId });
    const cols = await getCollections(spaceId).catch(() => []);
    setCollections(cols);
    if (cols.length > 0) {
      const stored = (await browser.storage.local.get([STORAGE_KEY_LAST_COLLECTION])) as Record<
        string,
        string | undefined
      >;
      const lastCol = stored[STORAGE_KEY_LAST_COLLECTION] as string | undefined;
      if (lastCol && cols.some((c) => c.id === lastCol)) {
        setSelectedCollectionId(lastCol);
      } else {
        setSelectedCollectionId(cols[0].id);
      }
    }
  }

  async function handleCollectionChange(collectionId: string) {
    setSelectedCollectionId(collectionId);
    if (collectionId) {
      await browser.storage.local.set({ [STORAGE_KEY_LAST_COLLECTION]: collectionId });
    }
  }

  async function handleSave() {
    if (!selectedCollectionId || !url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createBookmark({
        collectionId: selectedCollectionId,
        title: title.trim() || url,
        url: url.trim(),
        favicon: favicon || undefined,
      });
      await notifyBookmarksChanged({
        spaceId: selectedSpaceId,
        collectionId: selectedCollectionId,
      });
      await browser.storage.local.set({ [STORAGE_KEY_LAST_COLLECTION]: selectedCollectionId });
      setSaved(true);
      setTimeout(() => window.close(), 800);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6">
        <div className="flex size-10 items-center justify-center rounded-full bg-[var(--accent)]/20">
          <Check className="size-5 text-[var(--accent)]" />
        </div>
        <p className="text-sm font-medium text-[var(--foreground)]">Bookmark saved!</p>
        <p className="text-[10px] text-[var(--muted)]">
          → {collections.find((c) => c.id === selectedCollectionId)?.name}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <p className="text-xs text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Bookmark className="size-4 text-[var(--accent)]" />
        <h1 className="text-sm font-semibold text-[var(--foreground)]">Save Bookmark</h1>
      </div>

      {/* Title */}
      <div>
        <label className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Title</label>
        <input
          type="text"
          className="w-full rounded border border-[var(--border)] bg-[var(--field-background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* URL */}
      <div>
        <label className="mb-1 block text-[10px] font-medium text-[var(--muted)]">URL</label>
        <input
          type="text"
          className="w-full rounded border border-[var(--border)] bg-[var(--field-background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <FaviconField value={favicon} onChange={setFavicon} pageUrl={url} title={title} />

      {/* Save Location */}
      <div className="rounded border border-[var(--border)] bg-[var(--field-background)] p-2.5">
        <label className="mb-2 block text-[10px] font-medium text-[var(--muted)]">Save to</label>

        {/* Org selector */}
        {orgs.length > 0 && (
          <div className="mb-2">
            <label className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Organization</label>
            <div className="relative">
              <select
                className="w-full appearance-none rounded border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 pr-7 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
                value={selectedOrgId || ''}
                onChange={(e) => handleOrgChange(e.target.value)}
              >
                <option value="">Personal</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-[var(--muted)]" />
            </div>
          </div>
        )}

        {/* Space selector */}
        <div className="mb-2">
          <label className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Space</label>
          <div className="relative">
            <select
              className="w-full appearance-none rounded border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 pr-7 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
              value={selectedSpaceId || ''}
              onChange={(e) => handleSpaceChange(e.target.value)}
              disabled={spaces.length === 0}
            >
              {spaces.length === 0 && <option value="">No spaces</option>}
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isShared && s.ownerName ? `${s.name} (from ${s.ownerName})` : s.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-[var(--muted)]" />
          </div>
        </div>

        {/* Collection selector */}
        <div>
          <label className="mb-1 block text-[10px] font-medium text-[var(--muted)]">Collection</label>
          <div className="relative">
            <select
              className="w-full appearance-none rounded border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 pr-7 text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
              value={selectedCollectionId || ''}
              onChange={(e) => handleCollectionChange(e.target.value)}
              disabled={collections.length === 0}
            >
              {collections.length === 0 && <option value="">No collections</option>}
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-[var(--muted)]" />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-[10px] text-red-400">{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !selectedCollectionId || !url.trim()}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        <Layers className="size-3.5" />
        {saving ? 'Saving...' : 'Save Bookmark'}
      </button>
    </div>
  );
}
