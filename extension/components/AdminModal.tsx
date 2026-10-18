import { useState, useEffect, useRef, useCallback } from 'react';
import { X, RefreshCw, Copy, Check, Ban, KeyRound, LogOut, Trash2, Search, UserCheck, ChevronDown } from 'lucide-react';
import { admin, isUnauthorizedError } from '@/lib/api';
import type { AdminInvite, AdminStats, AdminUser, UserRole } from '@/lib/api';
import ConfirmModal from './ConfirmModal';
import PromptModal from './PromptModal';

const ROLES: UserRole[] = ['guest', 'user', 'admin'];
const PAGE_SIZE = 25;

const inputCls =
  'rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]';
const buttonCls =
  'flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px] text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50';
const iconButtonCls =
  'rounded p-1 text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:opacity-40';

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRelative(iso: string | null) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function quotaLabel(quota: number | null) {
  return quota === null ? '∞' : String(quota);
}

function Select({ className = '', compact = false, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <div className={`relative inline-block ${className}`}>
      <select
        {...props}
        className={`w-full cursor-pointer appearance-none rounded border border-[var(--border)] bg-[var(--background)] text-xs text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:cursor-default disabled:opacity-60 ${
          compact ? 'py-1 pl-2 pr-6' : 'py-1.5 pl-2 pr-7'
        }`}
      />
      <ChevronDown
        className={`pointer-events-none absolute top-1/2 size-3 -translate-y-1/2 text-[var(--muted)] ${compact ? 'right-1.5' : 'right-2'}`}
      />
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label}
      className={iconButtonCls}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3.5 text-[var(--accent)]" /> : <Copy className="size-3.5" />}
    </button>
  );
}

type PendingAction =
  | { kind: 'confirm'; title: string; message: string; label: string; run: () => Promise<unknown> }
  | { kind: 'prompt'; title: string; label: string; placeholder?: string; run: (value: string) => Promise<unknown> };

interface AdminModalProps {
  currentUserId: string;
  onClose: () => void;
}

export default function AdminModal({ currentUserId, onClose }: AdminModalProps) {
  const mousedownOnBackdropRef = useRef(false);
  const [tab, setTab] = useState<'users' | 'invites'>('users');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);

  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [inviteRole, setInviteRole] = useState<UserRole>('user');
  const [inviteUses, setInviteUses] = useState(1);
  const [inviteDays, setInviteDays] = useState(7);
  const [inviteEmail, setInviteEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<AdminInvite | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (isUnauthorizedError(err)) {
        onClose();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    },
    [onClose],
  );

  const loadStats = useCallback(() => admin.stats().then(setStats).catch(fail), [fail]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await admin.users({
        search: search.trim() || undefined,
        role: roleFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setUsers(res.users);
      setTotal(res.total);
    } catch (err) {
      fail(err);
    } finally {
      setUsersLoading(false);
    }
  }, [search, roleFilter, page, fail]);

  const loadInvites = useCallback(() => admin.invites().then((r) => setInvites(r.invites)).catch(fail), [fail]);

  useEffect(() => {
    void loadStats();
    void loadInvites();
  }, [loadStats, loadInvites]);

  useEffect(() => {
    const t = setTimeout(() => void loadUsers(), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadUsers, search]);

  const refreshAll = () => {
    setError(null);
    void loadStats();
    void loadUsers();
    void loadInvites();
  };

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      void loadStats();
      void loadUsers();
    } catch (err) {
      fail(err);
    }
  };

  const changeRole = (u: AdminUser, role: UserRole) => {
    if (role === u.role) return;
    if (role === 'admin') {
      setPending({
        kind: 'confirm',
        title: 'Make admin?',
        message: `${u.email} will be able to manage every user and invite on this server.`,
        label: 'Make admin',
        run: () => admin.setRole(u.id, role),
      });
      return;
    }
    void run(() => admin.setRole(u.id, role), `${u.email} is now ${role}`);
  };

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setCreated(null);
    try {
      const { invite, emailed } = await admin.createInvite({
        role: inviteRole,
        maxUses: inviteUses,
        expiresInDays: inviteDays,
        email: inviteEmail.trim() || undefined,
      });
      setCreated(invite);
      setInviteEmail('');
      setNotice(emailed ? `Invitation emailed to ${invite.emails.join(', ')}` : null);
      void loadInvites();
      void loadStats();
    } catch (err) {
      fail(err);
    } finally {
      setCreating(false);
    }
  };

  const visibleInvites = showInactive ? invites : invites.filter((i) => i.status === 'pending');
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)]" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Admin</h3>
          <div className="flex items-center gap-1">
            <button type="button" title="Refresh" onClick={refreshAll} className={iconButtonCls}>
              <RefreshCw className="size-3.5" />
            </button>
            <button type="button" onClick={onClose} className={iconButtonCls}>
              <X className="size-4" />
            </button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-2 border-b border-[var(--border)] px-5 py-3 sm:grid-cols-5">
            {[
              ['Users', stats.users, ROLES.map((r) => `${stats.usersByRole[r] ?? 0} ${r}`).join(' · ')],
              ['New (7d)', stats.newUsers7d, null],
              ['Active (7d)', stats.activeUsers7d, null],
              ['Bookmarks', stats.bookmarks, null],
              ['Open invites', stats.pendingInvites, null],
            ].map(([label, value, sub]) => (
              <div key={label as string} className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
                <p className="text-base font-semibold text-[var(--foreground)]">{value}</p>
                {sub && <p className="truncate text-[10px] text-[var(--muted)]">{sub}</p>}
              </div>
            ))}
            <p className="col-span-full text-[10px] text-[var(--muted)]">
              Registration: <strong>{stats.config.inviteMode === 'open' ? 'open' : 'invite only'}</strong>
              {stats.config.inviteMode === 'open' && <> (new accounts start as <strong>{stats.config.defaultRole}</strong>)</>}
              {' · '}Bookmark quota: {ROLES.map((r) => `${r} ${quotaLabel(stats.config.quotas[r])}`).join(', ')}
              {' · '}Email {stats.config.emailEnabled ? 'enabled' : 'not configured'}
            </p>
          </div>
        )}

        <div className="flex gap-4 border-b border-[var(--border)] px-5">
          {(['users', 'invites'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 py-2 text-xs font-medium capitalize ${
                tab === t ? 'border-[var(--accent)] text-[var(--foreground)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {(error || notice) && (
          <div className="px-5 pt-3">
            {error && <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-400">{error}</p>}
            {notice && !error && <p className="rounded border border-[var(--accent)]/30 px-3 py-1.5 text-[11px] text-[var(--accent)]">{notice}</p>}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {tab === 'users' ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    className={`${inputCls} w-full pl-7`}
                    placeholder="Search email or name"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  />
                </div>
                <Select
                  value={roleFilter}
                  onChange={(e) => { setRoleFilter(e.target.value as UserRole | ''); setPage(0); }}
                >
                  <option value="">All roles</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>

              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="py-1.5 font-medium">User</th>
                    <th className="py-1.5 font-medium">Role</th>
                    <th className="py-1.5 font-medium">Bookmarks</th>
                    <th className="py-1.5 font-medium">Joined</th>
                    <th className="py-1.5 font-medium">Last active</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const self = u.id === currentUserId;
                    const overQuota = u.quota !== null && u.bookmarkCount >= u.quota;
                    return (
                      <tr key={u.id} className={`border-t border-[var(--border)] ${u.banned ? 'opacity-60' : ''}`}>
                        <td className="py-2 pr-2">
                          <p className="text-[var(--foreground)]">
                            {u.name || '—'}
                            {self && <span className="ml-1 text-[10px] text-[var(--muted)]">(you)</span>}
                          </p>
                          <p className="text-[10px] text-[var(--muted)]">{u.email}</p>
                          {u.banned && (
                            <p className="text-[10px] text-red-400">Banned{u.banReason ? `: ${u.banReason}` : ''}</p>
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          <Select
                            compact
                            className="w-20"
                            value={u.role}
                            disabled={self || u.isEnvAdmin}
                            title={u.isEnvAdmin ? 'Admin via ADMIN_USER_IDS' : undefined}
                            onChange={(e) => changeRole(u, e.target.value as UserRole)}
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </Select>
                        </td>
                        <td className={`py-2 pr-2 ${overQuota ? 'text-amber-400' : 'text-[var(--foreground)]'}`}>
                          {u.bookmarkCount} / {quotaLabel(u.quota)}
                        </td>
                        <td className="py-2 pr-2 text-[var(--muted)]">{formatDate(u.createdAt)}</td>
                        <td className="py-2 pr-2 text-[var(--muted)]">{formatRelative(u.lastActiveAt)}</td>
                        <td className="py-2">
                          <div className="flex justify-end gap-0.5">
                            <button
                              type="button"
                              title="Set password"
                              className={iconButtonCls}
                              onClick={() =>
                                setPending({
                                  kind: 'prompt',
                                  title: `New password for ${u.email}`,
                                  label: self ? 'At least 8 characters.' : 'At least 8 characters. Their other sessions are signed out.',
                                  run: (pw) => {
                                    if (pw.length < 8) return Promise.reject(new Error('Password must be at least 8 characters'));
                                    return admin.setPassword(u.id, pw);
                                  },
                                })
                              }
                            >
                              <KeyRound className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Sign out everywhere"
                              disabled={self}
                              className={iconButtonCls}
                              onClick={() => void run(() => admin.revokeSessions(u.id), `Signed ${u.email} out of all devices`)}
                            >
                              <LogOut className="size-3.5" />
                            </button>
                            {u.banned ? (
                              <button
                                type="button"
                                title="Unban"
                                className={iconButtonCls}
                                onClick={() => void run(() => admin.unban(u.id), `Unbanned ${u.email}`)}
                              >
                                <UserCheck className="size-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Ban"
                                disabled={self}
                                className={iconButtonCls}
                                onClick={() =>
                                  setPending({
                                    kind: 'prompt',
                                    title: `Ban ${u.email}`,
                                    label: 'Reason (shown to nobody but admins). They are signed out and cannot sign in.',
                                    placeholder: 'e.g. spam',
                                    run: (reason) => admin.ban(u.id, reason),
                                  })
                                }
                              >
                                <Ban className="size-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Delete account"
                              disabled={self}
                              className={`${iconButtonCls} hover:text-red-400`}
                              onClick={() =>
                                setPending({
                                  kind: 'confirm',
                                  title: 'Delete account?',
                                  message: `${u.email} and all of their spaces, collections and ${u.bookmarkCount} bookmarks will be permanently deleted.`,
                                  label: 'Delete',
                                  run: () => admin.deleteUser(u.id),
                                })
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!usersLoading && users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[11px] text-[var(--muted)]">No users found</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--muted)]">
                <span>{usersLoading ? 'Loading…' : `${total} user${total === 1 ? '' : 's'}`}</span>
                {pages > 1 && (
                  <div className="flex items-center gap-2">
                    <button type="button" className={buttonCls} disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
                    <span>{page + 1} / {pages}</span>
                    <button type="button" className={buttonCls} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <form onSubmit={createInvite} className="mb-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
                <p className="mb-2 text-[11px] font-medium text-[var(--foreground)]">New invite</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[10px] text-[var(--muted)]">
                    Role
                    <Select className="mt-0.5 block w-24" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </label>
                  <label className="text-[10px] text-[var(--muted)]">
                    Uses
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      className={`${inputCls} mt-0.5 block w-20`}
                      value={inviteUses}
                      onChange={(e) => setInviteUses(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </label>
                  <label className="text-[10px] text-[var(--muted)]">
                    Expires in
                    <Select className="mt-0.5 block w-24" value={inviteDays} onChange={(e) => setInviteDays(Number(e.target.value))}>
                      <option value={1}>1 day</option>
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                    </Select>
                  </label>
                  <label className="min-w-[10rem] flex-1 text-[10px] text-[var(--muted)]">
                    Email (optional{stats && !stats.config.emailEnabled ? ', needs RESEND_API_KEY' : ''})
                    <input
                      type="email"
                      className={`${inputCls} mt-0.5 block w-full`}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Restrict to and email this address"
                      disabled={!!stats && !stats.config.emailEnabled}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {creating ? 'Creating…' : 'Create'}
                  </button>
                </div>
                {inviteRole === 'admin' && (
                  <p className="mt-2 text-[10px] text-amber-400">Anyone with this link becomes an admin of this server.</p>
                )}
                {created && (
                  <div className="mt-3 rounded border border-[var(--accent)]/30 px-3 py-2">
                    <p className="text-[10px] text-[var(--muted)]">
                      Share this link. It explains how to install the extension and sign up with the code.
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <code className="min-w-0 flex-1 truncate text-[11px] text-[var(--foreground)]">{created.url}</code>
                      <CopyButton text={created.url} label="Copy link" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-[var(--muted)]">Code</span>
                      <code className="min-w-0 flex-1 truncate text-[11px] text-[var(--foreground)]">{created.code}</code>
                      <CopyButton text={created.code} label="Copy code" />
                    </div>
                  </div>
                )}
              </form>

              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] text-[var(--muted)]">{visibleInvites.length} invite{visibleInvites.length === 1 ? '' : 's'}</p>
                <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                  Show used, expired and revoked
                </label>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="py-1.5 font-medium">Code</th>
                    <th className="py-1.5 font-medium">Role</th>
                    <th className="py-1.5 font-medium">Used</th>
                    <th className="py-1.5 font-medium">Expires</th>
                    <th className="py-1.5 font-medium">For / by</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {visibleInvites.map((i) => (
                    <tr key={i.code} className={`border-t border-[var(--border)] ${i.status === 'pending' ? '' : 'opacity-60'}`}>
                      <td className="py-2 pr-2 font-mono text-[11px] text-[var(--foreground)]">
                        {i.code.slice(0, 8)}…
                        {i.status !== 'pending' && <span className="ml-1 font-sans text-[10px] text-[var(--muted)]">{i.status}</span>}
                      </td>
                      <td className={`py-2 pr-2 ${i.role === 'admin' ? 'text-amber-400' : 'text-[var(--foreground)]'}`}>{i.role}</td>
                      <td className="py-2 pr-2 text-[var(--foreground)]">{i.uses} / {i.maxUses ?? '∞'}</td>
                      <td className="py-2 pr-2 text-[var(--muted)]">{formatDate(i.expiresAt)}</td>
                      <td className="py-2 pr-2 text-[10px] text-[var(--muted)]">
                        {i.emails.length > 0 && <p>{i.emails.join(', ')}</p>}
                        {i.createdBy && <p>by {i.createdBy}</p>}
                      </td>
                      <td className="py-2">
                        <div className="flex justify-end gap-0.5">
                          {i.status === 'pending' && (
                            <>
                              <CopyButton text={i.url} label="Copy link" />
                              <button
                                type="button"
                                title="Revoke"
                                className={`${iconButtonCls} hover:text-red-400`}
                                onClick={() =>
                                  void admin
                                    .revokeInvite(i.code)
                                    .then(() => {
                                      if (created?.code === i.code) setCreated(null);
                                      void loadInvites();
                                      void loadStats();
                                    })
                                    .catch(fail)
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {visibleInvites.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[11px] text-[var(--muted)]">No invites</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={pending?.kind === 'confirm'}
        title={pending?.kind === 'confirm' ? pending.title : ''}
        message={pending?.kind === 'confirm' ? pending.message : ''}
        confirmLabel={pending?.kind === 'confirm' ? pending.label : undefined}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending?.kind !== 'confirm') return;
          const action = pending;
          setPending(null);
          void run(action.run, 'Done');
        }}
      />
      <PromptModal
        isOpen={pending?.kind === 'prompt'}
        title={pending?.kind === 'prompt' ? pending.title : ''}
        label={pending?.kind === 'prompt' ? pending.label : undefined}
        placeholder={pending?.kind === 'prompt' ? pending.placeholder : undefined}
        onClose={() => setPending(null)}
        onSubmit={(value) => {
          if (pending?.kind !== 'prompt') return;
          const action = pending;
          setPending(null);
          void run(() => action.run(value), 'Done');
        }}
      />
    </div>
  );
}
