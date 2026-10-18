import { useState, useRef } from 'react';
import { X, Upload, Download, Shield, ShieldCheck } from 'lucide-react';
import { DEFAULT_API_BASE, getApiBase, setApiBase, importFromNiceTab, importFromToby, importNative, exportData, redeemInvite } from '@/lib/api';
import type { User } from '@/lib/api';
import { reportServerReachable, reportServerUnreachable } from '@/lib/serverReachability';

interface SettingsModalProps {
  onClose: () => void;
  onImportDone?: () => void;
  /** Called after API base URL actually changes (session already cleared). */
  onServerChanged?: () => void;
  activeOrgId?: string | null;
  activeOrgName?: string;
  onDeleteAllSpaces?: () => void;
  user?: User | null;
  /** Called after redeeming an invite so the caller can reload the user's role. */
  onUserChanged?: () => void;
  onOpenAdmin?: () => void;
}

export default function SettingsModal({ onClose, onImportDone, onServerChanged, activeOrgId, activeOrgName = 'Personal', onDeleteAllSpaces, user, onUserChanged, onOpenAdmin }: SettingsModalProps) {
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemStatus, setRedeemStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const mousedownOnBackdropRef = useRef(false);
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [latency, setLatency] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const niceTabInputRef = useRef<HTMLInputElement>(null);
  const tobyInputRef = useRef<HTMLInputElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeleteAll, setShowDeleteAll] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setStatus('idle');
    setLatency(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const start = performance.now();
    try {
      const { changed, hadSession } = await setApiBase(serverUrl);
      setServerUrl(getApiBase());
      const res = await fetch(getApiBase().replace(/\/api$/, '') + '/health', { signal: controller.signal });
      if (res.ok) {
        reportServerReachable();
        setLatency(Math.round(performance.now() - start));
        setStatus('success');
        if (changed && hadSession) {
          onServerChanged?.();
          return;
        }
      } else {
        setStatus('error');
      }
    } catch {
      reportServerUnreachable();
      setStatus('error');
    } finally {
      clearTimeout(timer);
      setSaving(false);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setRedeeming(true);
    setRedeemStatus(null);
    try {
      const { role } = await redeemInvite(redeemCode);
      setRedeemCode('');
      setRedeemStatus({ ok: true, text: `Invite applied — your account is now "${role}".` });
      onUserChanged?.();
    } catch (err: any) {
      setRedeemStatus({ ok: false, text: err.message || 'Could not redeem invite' });
    } finally {
      setRedeeming(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>, format: 'nicetab' | 'toby' | 'native') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportStatus(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      let result;
      if (format === 'native') {
        result = await importNative(data, activeOrgId);
      } else if (format === 'nicetab') {
        result = await importFromNiceTab(data, activeOrgId);
      } else {
        result = await importFromToby(data, activeOrgId);
      }
      setImportStatus(
        `Imported ${result.stats.spacesCreated} spaces, ${result.stats.collectionsCreated} collections, ${result.stats.bookmarksCreated} bookmarks`,
      );
      onImportDone?.();
    } catch (err: any) {
      setImportStatus(`Error: ${err.message}`);
    } finally {
      setImporting(false);
      if (niceTabInputRef.current) niceTabInputRef.current.value = '';
      if (tobyInputRef.current) tobyInputRef.current.value = '';
      if (nativeInputRef.current) nativeInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportStatus(null);
    try {
      const data = await exportData(activeOrgId);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      const safeName = activeOrgName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
      a.download = `bookmarks-${safeName}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus(`Exported ${data.spaces.length} spaces`);
    } catch (err: any) {
      setExportStatus(`Error: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    mousedownOnBackdropRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (!mousedownOnBackdropRef.current) return;
    mousedownOnBackdropRef.current = false;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] p-4" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div
        className="flex max-h-[min(90vh,calc(100vh-2rem))] w-full max-w-md flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-6">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Settings</h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 pb-1">
          {user && (
            <div>
              <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]">
                <Shield className="size-3" />
                Account
              </label>
              <div className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <p className="text-xs text-[var(--foreground)]">{user.name}</p>
                <p className="text-[10px] text-[var(--muted)]">{user.email}</p>
                {user.role && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--accent)]">
                    {user.role === 'guest' ? 'Guest (limited quota)' : user.role}
                  </p>
                )}
              </div>
              {user.isAdmin && onOpenAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="mt-2 flex items-center gap-1.5 rounded border border-[var(--accent)]/30 bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface)]"
                >
                  <ShieldCheck className="size-3.5" />
                  Admin panel
                </button>
              )}
              {!user.isAdmin && (
                <form onSubmit={handleRedeem} className="mt-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs text-[var(--foreground)] outline-none placeholder:font-sans placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
                      value={redeemCode}
                      onChange={(e) => setRedeemCode(e.target.value)}
                      placeholder="Invite code or link"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="submit"
                      disabled={redeeming || !redeemCode.trim()}
                      className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
                    >
                      {redeeming ? 'Redeeming…' : 'Redeem invite'}
                    </button>
                  </div>
                  {redeemStatus && (
                    <p className={`mt-1 text-[11px] ${redeemStatus.ok ? 'text-[var(--accent)]' : 'text-red-400'}`}>{redeemStatus.text}</p>
                  )}
                </form>
              )}
            </div>
          )}
          {/* Server URL */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Server URL</label>
            <p className="mb-2 text-[10px] text-[var(--muted)]">
              Point to your self-hosted server's API endpoint
            </p>
            <input
              type="url"
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder={DEFAULT_API_BASE}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Testing...' : 'Save & Test'}
              </button>
              {status === 'success' && (
                <span className="text-[11px] text-[var(--accent)]">
                  Connected{latency !== null ? ` (${latency} ms)` : ''}
                </span>
              )}
              {status === 'error' && (
                <span className="text-[11px] text-red-400">Connection failed</span>
              )}
            </div>
          </div>

          {/* Export */}
          <div className="border-t border-[var(--border)] pt-4">
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Export Data</label>
            <p className="mb-2 text-[10px] text-[var(--muted)]">
              Export all spaces, collections, and bookmarks from the current context as JSON
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
            >
              <Download className="size-3.5" />
              {exporting ? 'Exporting...' : 'Export JSON'}
            </button>
            {exportStatus && (
              <p className={`mt-2 text-[11px] ${exportStatus.startsWith('Error') ? 'text-red-400' : 'text-[var(--accent)]'}`}>
                {exportStatus}
              </p>
            )}
          </div>

          {/* Import */}
          <div className="border-t border-[var(--border)] pt-4">
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Import Data</label>
            <p className="mb-2 text-[10px] text-[var(--muted)]">
              Import bookmarks from a previous export, NiceTab, or Toby (JSON)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => nativeInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1.5 rounded border border-[var(--accent)]/30 bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                <Upload className="size-3.5" />
                {importing ? 'Importing...' : 'From Export'}
              </button>
              <button
                onClick={() => niceTabInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                <Upload className="size-3.5" />
                {importing ? 'Importing...' : 'NiceTab'}
              </button>
              <button
                onClick={() => tobyInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                <Upload className="size-3.5" />
                {importing ? 'Importing...' : 'Toby'}
              </button>
              <input
                ref={nativeInputRef}
                type="file"
                accept=".json"
                onChange={(e) => handleImport(e, 'native')}
                className="hidden"
              />
              <input
                ref={niceTabInputRef}
                type="file"
                accept=".json"
                onChange={(e) => handleImport(e, 'nicetab')}
                className="hidden"
              />
              <input
                ref={tobyInputRef}
                type="file"
                accept=".json"
                onChange={(e) => handleImport(e, 'toby')}
                className="hidden"
              />
            </div>
            {importStatus && (
              <p className={`mt-2 text-[11px] ${importStatus.startsWith('Error') ? 'text-red-400' : 'text-[var(--accent)]'}`}>
                {importStatus}
              </p>
            )}
          </div>

          {/* Account section */}
          <div className="border-t border-[var(--border)] pt-4">
            <label className="mb-1 block text-[11px] font-medium text-[var(--muted)]">Account</label>
            <p className="text-[10px] text-[var(--muted)]">
              Signed in with a session token kept in this browser's extension storage. Sessions stay valid while
              you use them and expire after a period of inactivity; signing out revokes them on the server.
            </p>
            <a
              href={`${getApiBase().replace(/\/api$/, '')}/privacy`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[10px] text-[var(--accent)] hover:underline"
            >
              Privacy policy
            </a>
          </div>

          {/* Danger zone */}
          {onDeleteAllSpaces && (
            <div className="border-t border-red-500/30 pt-4">
              <label className="mb-1 block text-[11px] font-medium text-red-400">Danger Zone</label>
              {!showDeleteAll ? (
                <button
                  onClick={() => setShowDeleteAll(true)}
                  className="rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                >
                  Delete All Spaces
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-[var(--muted)]">
                    Type <strong className="text-red-400">DELETE ALL</strong> to confirm
                  </p>
                  <input
                    type="text"
                    className="w-full rounded border border-red-500/30 bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-red-400"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="DELETE ALL"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(''); }}
                      className="rounded px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--background)]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { onDeleteAllSpaces(); onClose(); }}
                      disabled={deleteConfirmText !== 'DELETE ALL'}
                      className="rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-30"
                    >
                      Delete All Spaces
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-6 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--background)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
