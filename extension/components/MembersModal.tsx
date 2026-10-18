import { useState, useEffect, useRef } from 'react';
import { X, UserPlus, Crown, Trash2 } from 'lucide-react';
import {
  getOrgMembers,
  addOrgMember,
  removeOrgMember,
  getSpaceMembers,
  addSpaceMember,
  removeSpaceMember,
  updateMemberRole,
} from '@/lib/api';
import type { OrgMember, SpaceMember } from '@/lib/api';

const ORG_MEMBER_REQUIRED = 'User must be an org member first';

interface MembersModalProps {
  /** When set, manage org members; otherwise manage space members via spaceId */
  orgId?: string | null;
  orgName?: string;
  spaceId: string | null;
  spaceName: string;
  onClose: () => void;
  /** Org mode: only owners can change roles / assign admin. Space mode: always true for space owners. */
  canChangeRoles?: boolean;
  /** Space is inside an org — show invite hint about org membership */
  isOrgSpace?: boolean;
  /** Parent org for org-space invites (space mode) */
  parentOrgId?: string | null;
  parentOrgName?: string;
  /** Caller can add people to the parent org */
  canAddOrgMembers?: boolean;
  /** Open the org members modal from a space invite */
  onOpenOrgMembers?: () => void;
}

export default function MembersModal({
  orgId,
  orgName,
  spaceId,
  spaceName,
  onClose,
  canChangeRoles = true,
  isOrgSpace = false,
  parentOrgId = null,
  parentOrgName,
  canAddOrgMembers = false,
  onOpenOrgMembers,
}: MembersModalProps) {
  const mousedownOnBackdropRef = useRef(false);
  const isOrgMode = !!orgId;

  const [owner, setOwner] = useState<{ id: string; email: string; name: string } | null>(null);
  const [members, setMembers] = useState<(OrgMember | SpaceMember)[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>(isOrgMode ? 'member' : 'viewer');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOrgMember, setNeedsOrgMember] = useState(false);

  const fetchMembers = async () => {
    try {
      if (isOrgMode) {
        const data = await getOrgMembers(orgId!);
        setOwner(data.owner);
        setMembers(data.members);
      } else if (spaceId) {
        const data = await getSpaceMembers(spaceId);
        setOwner(data.owner);
        // Hide the space owner row (shown separately) and any 'owner' role entries
        setMembers(data.members.filter((m) => m.userId !== data.owner?.id && m.role !== 'owner'));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMembers(); }, [orgId, spaceId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    setError(null);
    setNeedsOrgMember(false);
    try {
      if (isOrgMode) {
        await addOrgMember(orgId!, email.trim(), role as 'admin' | 'member');
      } else if (spaceId) {
        await addSpaceMember(spaceId, email.trim(), role as 'editor' | 'viewer');
      }
      setEmail('');
      fetchMembers();
    } catch (err: any) {
      const message = err?.message || 'Failed to add member';
      setError(message);
      setNeedsOrgMember(message.includes(ORG_MEMBER_REQUIRED));
    } finally {
      setAdding(false);
    }
  };

  const handleAddToOrgThenSpace = async () => {
    if (!email.trim() || !parentOrgId || !spaceId) return;
    setAdding(true);
    setError(null);
    setNeedsOrgMember(false);
    try {
      await addOrgMember(parentOrgId, email.trim(), 'member');
      await addSpaceMember(spaceId, email.trim(), role as 'editor' | 'viewer');
      setEmail('');
      fetchMembers();
    } catch (err: any) {
      setError(err?.message || 'Failed to add member');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (isOrgMode) {
      await removeOrgMember(orgId!, userId);
    } else if (spaceId) {
      await removeSpaceMember(spaceId, userId);
    }
    fetchMembers();
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (isOrgMode) {
      await removeOrgMember(orgId!, userId);
      await addOrgMember(orgId!, members.find((m) => m.userId === userId)?.email || '', newRole as 'admin' | 'member');
    } else if (spaceId) {
      await updateMemberRole(spaceId, userId, newRole as 'editor' | 'viewer');
    }
    fetchMembers();
  };

  const title = isOrgMode ? `Members — ${orgName}` : `Members — ${spaceName}`;
  const roleOptions = isOrgMode
    ? canChangeRoles
      ? [{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]
      : [{ value: 'member', label: 'Member' }]
    : [{ value: 'viewer', label: 'Viewer' }, { value: 'editor', label: 'Editor' }];

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
        className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X className="size-4" />
          </button>
        </div>

        {isOrgMode ? (
          <p className="mb-3 text-[10px] text-[var(--muted)]">
            Org members cannot see a space until they are invited to it. Inviting someone to the org does not add them to existing spaces.
          </p>
        ) : isOrgSpace ? (
          <p className="mb-3 text-[10px] text-[var(--muted)]">
            People must be in the organization before you can invite them here. They will not see this space until invited. Editor can edit; viewer is read-only.
            {onOpenOrgMembers && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={onOpenOrgMembers}
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Manage org members
                </button>
              </>
            )}
          </p>
        ) : null}

        {/* Add member form */}
        <form onSubmit={handleAdd} className="mb-4 flex gap-2">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent)]"
          />
          {(canChangeRoles || !isOrgMode) ? (
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-2 text-xs text-[var(--foreground)] outline-none"
            >
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : null}
          <button
            type="submit"
            disabled={adding || !email.trim()}
            className="flex items-center gap-1 rounded bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            <UserPlus className="size-3" />
            Add
          </button>
        </form>

        {error && (
          <div className="mb-3 space-y-2 rounded border border-red-400/30 bg-red-400/5 px-3 py-2">
            <p className="text-[11px] text-red-400">{error}</p>
            {needsOrgMember && !isOrgMode && (
              <div className="flex flex-wrap items-center gap-2">
                {canAddOrgMembers && parentOrgId && (
                  <button
                    type="button"
                    disabled={adding || !email.trim()}
                    onClick={() => void handleAddToOrgThenSpace()}
                    className="rounded bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    Add to {parentOrgName || 'org'} & invite
                  </button>
                )}
                {onOpenOrgMembers && (
                  <button
                    type="button"
                    onClick={onOpenOrgMembers}
                    className="rounded px-2.5 py-1 text-[11px] text-[var(--accent)] hover:bg-[var(--background)]"
                  >
                    Open org members
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Member list */}
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {loading && <p className="text-xs text-[var(--muted)]">Loading...</p>}

          {owner && (
            <div className="flex items-center justify-between rounded bg-[var(--background)] px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                  {owner.name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-xs text-[var(--foreground)]">{owner.name}</p>
                  <p className="text-[10px] text-[var(--muted)]">{owner.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-[#f59e0b]">
                <Crown className="size-3" />
                Owner
              </div>
            </div>
          )}

          {members.map((member) => (
            <div key={member.userId} className="flex items-center justify-between rounded px-3 py-2 hover:bg-[var(--background)]">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-full bg-[var(--background)] text-[10px] font-bold text-[var(--muted)]">
                  {member.name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-xs text-[var(--foreground)]">{member.name}</p>
                  <p className="text-[10px] text-[var(--muted)]">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canChangeRoles ? (
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] outline-none"
                  >
                    {roleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[10px] capitalize text-[var(--muted)]">{member.role}</span>
                )}
                <button
                  onClick={() => handleRemove(member.userId)}
                  className="text-[var(--muted)] hover:text-red-400"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}

          {!loading && members.length === 0 && (
            <p className="py-2 text-center text-xs text-[var(--muted)]">No members yet</p>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--background)]">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
