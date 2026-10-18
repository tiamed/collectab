import { clearDataCache, hasCachedData } from './dataCache';
import {
  configureHealthUrl,
  isAbortError,
  isNetworkFailure,
  reportServerReachable,
  reportServerUnreachable,
} from './serverReachability';

const STORAGE_KEY_BASE_URL = 'api_base_url';
const STORAGE_KEY_ACCESS_TOKEN = 'access_token';
/** Left behind by the pre-Better-Auth JWT client; never read, only purged. */
const LEGACY_STORAGE_KEYS = ['refresh_token'] as const;
const SESSION_UI_KEYS = [
  'active_org_id',
  'active_space_id',
  'popup_last_space',
  'popup_last_collection',
  'personal_org_name',
] as const;

export const DEFAULT_API_BASE: string = normalizeApiBase(
  (import.meta.env.WXT_API_BASE_URL as string | undefined) || 'http://localhost:3001/api',
);

let apiBase: string = DEFAULT_API_BASE;
let accessToken: string | null = null;

configureHealthUrl(() => apiBase.replace(/\/api\/?$/, '') + '/health');

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** Accepts "https://host", "https://host/" or "https://host/api" and returns ".../api". */
export function normalizeApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
}

type SessionListener = (loggedIn: boolean) => void;
const sessionListeners = new Set<SessionListener>();

/** Fires when the token is added/removed in any extension context (popup, newtab, background). */
export function subscribeSession(cb: SessionListener): () => void {
  sessionListeners.add(cb);
  return () => {
    sessionListeners.delete(cb);
  };
}

let storageListenerInstalled = false;
function installStorageListener() {
  if (storageListenerInstalled || typeof browser === 'undefined' || !browser.storage?.onChanged) return;
  storageListenerInstalled = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY_BASE_URL]?.newValue) {
      apiBase = changes[STORAGE_KEY_BASE_URL].newValue as string;
    }
    const tokenChange = changes[STORAGE_KEY_ACCESS_TOKEN];
    if (!tokenChange) return;
    const next = (tokenChange.newValue as string | undefined) ?? null;
    if (next === accessToken) return;
    accessToken = next;
    for (const cb of sessionListeners) cb(!!next);
  });
}

export async function loadApiBase() {
  installStorageListener();
  const stored = (await browser.storage.local.get([
    STORAGE_KEY_BASE_URL,
    STORAGE_KEY_ACCESS_TOKEN,
    ...LEGACY_STORAGE_KEYS,
  ])) as Record<string, string | undefined>;
  if (stored[STORAGE_KEY_BASE_URL]) {
    apiBase = stored[STORAGE_KEY_BASE_URL] as string;
  }
  accessToken = stored[STORAGE_KEY_ACCESS_TOKEN] ?? null;
  if (LEGACY_STORAGE_KEYS.some((k) => stored[k])) {
    // A JWT from the old auth system can never validate against Better Auth;
    // drop it so we don't send one doomed request per page load.
    accessToken = null;
    await browser.storage.local.remove([STORAGE_KEY_ACCESS_TOKEN, ...LEGACY_STORAGE_KEYS]);
  }
}

/**
 * Update API base URL. When the URL changes, clear auth tokens, data cache,
 * and UI selection so the previous server's orgs/spaces cannot linger.
 */
export async function setApiBase(url: string): Promise<{ changed: boolean; hadSession: boolean }> {
  const next = normalizeApiBase(url) || DEFAULT_API_BASE;
  const changed = next !== apiBase;
  apiBase = next;
  await browser.storage.local.set({ [STORAGE_KEY_BASE_URL]: apiBase });

  let hadSession = false;
  if (changed) {
    const before = (await browser.storage.local.get([
      STORAGE_KEY_ACCESS_TOKEN,
      ...SESSION_UI_KEYS,
    ])) as Record<string, string | undefined>;
    hadSession = !!before[STORAGE_KEY_ACCESS_TOKEN] || SESSION_UI_KEYS.some((k) => before[k]) || hasCachedData();
    await clearTokens();
    await clearDataCache();
    await browser.storage.local.remove([...SESSION_UI_KEYS]);
  }

  return { changed, hadSession };
}

export function getApiBase() {
  return apiBase;
}

export function getToken() {
  return accessToken;
}

export function isLoggedIn() {
  return !!accessToken;
}

async function persistToken(access: string) {
  accessToken = access;
  await browser.storage.local.set({ [STORAGE_KEY_ACCESS_TOKEN]: access });
}

async function clearTokens() {
  const had = !!accessToken;
  accessToken = null;
  await browser.storage.local.remove([STORAGE_KEY_ACCESS_TOKEN, ...LEGACY_STORAGE_KEYS]);
  if (had) for (const cb of sessionListeners) cb(false);
}

/**
 * Better Auth sessions are opaque, server-side and sliding (each use within
 * the last `updateAge` extends expiry), so there is no refresh endpoint to
 * call: a 401 means the session was revoked or expired and only a fresh
 * sign-in can fix it. Drop the token on the first 401 so every other
 * in-flight/future request short-circuits locally instead of hitting the server.
 */
async function handleUnauthorized(sentToken: string) {
  if (accessToken === sentToken) await clearTokens();
}

async function trackedFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    reportServerReachable();
    return res;
  } catch (e) {
    if (!isAbortError(e) && isNetworkFailure(e)) reportServerUnreachable();
    throw e;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = accessToken;
  if (!token) throw new ApiError('Not signed in', 401);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
  };

  const res = await trackedFetch(`${apiBase}${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    if (res.status === 401) await handleUnauthorized(token);
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || body.message || `Request failed: ${res.status}`, res.status);
  }

  return res.json();
}

// Auth
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role?: string | null;
  isAdmin?: boolean;
}

export interface ServerAuthConfig {
  inviteMode: 'open' | 'invite-only';
  google: boolean;
}

/** Public, unauthenticated: which sign-in options this server offers. */
export async function getServerAuthConfig(): Promise<ServerAuthConfig | null> {
  try {
    const res = await trackedFetch(`${apiBase}/auth-config`);
    if (!res.ok) return null;
    return (await res.json()) as ServerAuthConfig;
  } catch {
    return null;
  }
}

async function signInRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<{ user: User; token: string }> {
  const res = await trackedFetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(err.message || err.error || `Request failed: ${res.status}`, res.status);
  }
  const data = await res.json();
  const token = data.token ?? data.data?.token;
  if (!token) throw new Error('No session token returned');
  await persistToken(token);
  return { user: data.user ?? data.data?.user, token };
}

export async function login(email: string, password: string): Promise<{ user: User }> {
  return signInRequest('/auth/sign-in/email', { email, password });
}

export async function register(email: string, password: string, name: string, inviteCode?: string): Promise<{ user: User }> {
  const code = inviteCode?.trim();
  return signInRequest('/auth/sign-up/email', { email, password, name, ...(code ? { inviteCode: code } : {}) });
}

/** Accepts a bare code or a pasted invite link (`…/invite/<code>`). */
export function parseInviteCode(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/invite\/([^/?#\s]+)/);
  return match ? decodeURIComponent(match[1]) : trimmed;
}

export async function redeemInvite(code: string): Promise<{ role: string }> {
  return request('/invites/redeem', { method: 'POST', body: JSON.stringify({ code: parseInviteCode(code) }) });
}

// Admin (requires an admin account)
export type UserRole = 'guest' | 'user' | 'admin';

export interface AdminStats {
  users: number;
  usersByRole: Record<string, number>;
  newUsers7d: number;
  activeUsers7d: number;
  bookmarks: number;
  pendingInvites: number;
  config: {
    inviteMode: 'open' | 'invite-only';
    defaultRole: UserRole;
    quotas: Record<UserRole, number | null>;
    emailEnabled: boolean;
  };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  isEnvAdmin: boolean;
  bookmarkCount: number;
  quota: number | null;
  lastActiveAt: string | null;
}

export interface AdminInvite {
  code: string;
  url: string;
  role: UserRole;
  maxUses: number | null;
  uses: number;
  expiresAt: string;
  createdAt: string;
  createdBy?: string | null;
  emails: string[];
  status: 'pending' | 'expired' | 'used' | 'canceled' | 'rejected';
}

export const admin = {
  stats: () => request<AdminStats>('/admin/stats'),
  users: (params: { search?: string; role?: UserRole; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
    return request<{ total: number; users: AdminUser[] }>(`/admin/users?${q}`);
  },
  setRole: (id: string, role: UserRole) =>
    request<{ ok: true }>(`/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  setPassword: (id: string, newPassword: string) =>
    request<{ ok: true }>(`/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),
  ban: (id: string, reason?: string) =>
    request<{ ok: true }>(`/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) }),
  unban: (id: string) => request<{ ok: true }>(`/admin/users/${id}/unban`, { method: 'POST', body: '{}' }),
  revokeSessions: (id: string) =>
    request<{ ok: true }>(`/admin/users/${id}/revoke-sessions`, { method: 'POST', body: '{}' }),
  deleteUser: (id: string) => request<void>(`/admin/users/${id}`, { method: 'DELETE' }),
  invites: () => request<{ invites: AdminInvite[] }>('/admin/invites'),
  createInvite: (body: { role: UserRole; maxUses: number; expiresInDays: number; email?: string }) =>
    request<{ invite: AdminInvite; emailed: boolean }>('/admin/invites', { method: 'POST', body: JSON.stringify(body) }),
  revokeInvite: (code: string) => request<void>(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
};

/**
 * The whole OAuth dance runs inside the identity auth window against the
 * server's own origin (first-party cookies), and the server hands the session
 * token back to the extension via the URL fragment of the
 * `https://<extension-id>.chromiumapp.org/` redirect.
 */
export async function loginWithGoogle(): Promise<{ user: User }> {
  const identity = browser.identity;
  if (!identity?.launchWebAuthFlow) throw new Error('This browser does not support OAuth sign-in');

  const redirectUri = identity.getRedirectURL('oauth');
  const startUrl = `${apiBase}/oauth/google/start?redirect_uri=${encodeURIComponent(redirectUri)}`;

  let callbackUrl: string | undefined;
  try {
    callbackUrl = await identity.launchWebAuthFlow({ url: startUrl, interactive: true });
  } catch (e) {
    throw new Error(e instanceof Error && e.message ? e.message : 'Google login cancelled');
  }
  if (!callbackUrl) throw new Error('Google login cancelled');

  const params = new URLSearchParams(new URL(callbackUrl).hash.replace(/^#/, ''));
  const error = params.get('error');
  if (error) throw new Error(`Google login failed: ${error}`);
  const token = params.get('token');
  if (!token) throw new Error('Google login did not return a session');
  await persistToken(token);

  const user = await getMe();
  if (!user) throw new Error('Could not load user after Google login');
  return { user };
}

/** Returns null both when signed out and on network errors; check isLoggedIn() to tell them apart. */
export async function getMe(): Promise<User | null> {
  if (!accessToken) return null;
  try {
    const data = await request<{ user: User }>('/auth/me');
    return data.user;
  } catch {
    return null;
  }
}

export async function logout() {
  const token = accessToken;
  await clearTokens();
  if (token) {
    try {
      await fetch(`${apiBase}/auth/sign-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      // server-side session revocation is best-effort
    }
  }
}

// Organizations
export interface Organization {
  id: string;
  name: string;
  icon: string;
  ownerId: string;
  role: 'owner' | 'admin' | 'member';
  createdAt: string;
}

export async function getOrganizations(): Promise<Organization[]> {
  const data = await request<{ organizations: Organization[] }>('/orgs');
  return data.organizations;
}

export async function createOrganization(name: string, icon?: string): Promise<Organization> {
  const data = await request<{ organization: Organization }>('/orgs', {
    method: 'POST',
    body: JSON.stringify({ name, icon }),
  });
  return { ...data.organization, role: 'owner' };
}

export async function updateOrganization(id: string, updates: { name?: string; icon?: string }): Promise<Organization> {
  const data = await request<{ organization: Organization }>(`/orgs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.organization;
}

export async function deleteOrganization(id: string): Promise<void> {
  await request(`/orgs/${id}`, { method: 'DELETE' });
}

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export async function getOrgMembers(orgId: string): Promise<{ owner: { id: string; email: string; name: string }; members: OrgMember[] }> {
  return request(`/orgs/${orgId}/members`);
}

export async function addOrgMember(orgId: string, email: string, role: 'admin' | 'member' = 'member'): Promise<OrgMember> {
  const data = await request<{ member: OrgMember }>(`/orgs/${orgId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  return data.member;
}

export async function removeOrgMember(orgId: string, memberId: string): Promise<void> {
  await request(`/orgs/${orgId}/members/${memberId}`, { method: 'DELETE' });
}

// Spaces
export interface Space {
  id: string;
  name: string;
  icon: string;
  orderIndex: number;
  ownerId: string;
  orgId?: string | null;
  createdAt: string;
  isShared?: boolean;
  ownerName?: string;
  myRole?: 'owner' | 'editor' | 'viewer' | null;
}

export async function getSpaces(orgId?: string | null): Promise<Space[]> {
  const query = orgId ? `?orgId=${orgId}` : '';
  const data = await request<{ spaces: Space[] }>(`/spaces${query}`);
  return data.spaces;
}

export async function createSpace(name: string, icon?: string, orgId?: string | null): Promise<Space> {
  const data = await request<{ space: Space }>('/spaces', {
    method: 'POST',
    body: JSON.stringify({ name, icon, orgId: orgId || undefined }),
  });
  return data.space;
}

export async function updateSpace(id: string, updates: { name?: string; icon?: string; orderIndex?: number }): Promise<Space> {
  const data = await request<{ space: Space }>(`/spaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.space;
}

export async function deleteSpace(id: string): Promise<void> {
  await request(`/spaces/${id}`, { method: 'DELETE' });
}

export async function deleteAllSpaces(orgId?: string | null): Promise<void> {
  const query = orgId ? `?orgId=${orgId}` : '';
  await request(`/spaces${query}`, { method: 'DELETE' });
}

// Collections
export interface Collection {
  id: string;
  spaceId: string;
  name: string;
  icon: string;
  color: string;
  orderIndex: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export async function getCollections(spaceId?: string, signal?: AbortSignal): Promise<Collection[]> {
  const query = spaceId ? `?spaceId=${spaceId}` : '';
  const data = await request<{ collections: Collection[] }>(
    `/collections${query}`,
    signal ? { signal } : {},
  );
  return data.collections;
}

export async function createCollection(spaceId: string, name: string, icon?: string, color?: string): Promise<Collection> {
  const data = await request<{ collection: Collection }>('/collections', {
    method: 'POST',
    body: JSON.stringify({ spaceId, name, icon, color }),
  });
  return data.collection;
}

export async function updateCollection(id: string, updates: { name?: string; icon?: string; color?: string; orderIndex?: number; spaceId?: string }): Promise<Collection> {
  const data = await request<{ collection: Collection }>(`/collections/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.collection;
}

export async function deleteCollection(id: string): Promise<void> {
  await request(`/collections/${id}`, { method: 'DELETE' });
}

// Bookmarks
export interface Bookmark {
  id: string;
  collectionId: string;
  title: string;
  url: string;
  description: string | null;
  favicon: string | null;
  tags: string[];
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export async function reorderBookmarks(collectionId: string, bookmarkIds: string[]): Promise<void> {
  await request(`/bookmarks/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ collectionId, bookmarkIds }),
  });
}

export async function getBookmarks(collectionId: string): Promise<Bookmark[]> {
  const data = await request<{ bookmarks: Bookmark[] }>(`/bookmarks?collectionId=${collectionId}`);
  return data.bookmarks;
}

export async function getBookmarksBySpace(
  spaceId: string,
  signal?: AbortSignal,
): Promise<Record<string, Bookmark[]>> {
  const data = await request<{ bookmarksByCollection: Record<string, Bookmark[]> }>(
    `/bookmarks?spaceId=${encodeURIComponent(spaceId)}`,
    signal ? { signal } : {},
  );
  return data.bookmarksByCollection;
}

export async function createBookmark(params: {
  collectionId: string;
  title: string;
  url: string;
  description?: string;
  favicon?: string;
  tags?: string[];
}): Promise<Bookmark> {
  const data = await request<{ bookmark: Bookmark }>('/bookmarks', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.bookmark;
}

export async function updateBookmark(id: string, updates: {
  title?: string;
  url?: string;
  description?: string;
  favicon?: string;
  tags?: string[];
  orderIndex?: number;
  collectionId?: string;
}): Promise<Bookmark> {
  const data = await request<{ bookmark: Bookmark }>(`/bookmarks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.bookmark;
}

export async function deleteBookmark(id: string): Promise<void> {
  await request(`/bookmarks/${id}`, { method: 'DELETE' });
}

export async function batchCreateBookmarks(collectionId: string, bookmarks: { title: string; url: string; description?: string; favicon?: string; tags?: string[] }[]): Promise<Bookmark[]> {
  const data = await request<{ bookmarks: Bookmark[] }>('/bookmarks/batch', {
    method: 'POST',
    body: JSON.stringify({ collectionId, bookmarks }),
  });
  return data.bookmarks;
}

// Import
export interface ImportResult {
  message: string;
  stats: { spacesCreated: number; collectionsCreated: number; bookmarksCreated: number };
}

export async function importFromNiceTab(data: unknown, orgId?: string | null): Promise<ImportResult> {
  return request<ImportResult>('/import', {
    method: 'POST',
    body: JSON.stringify({ format: 'nicetab', data, orgId: orgId || undefined }),
  });
}

export async function importFromToby(data: unknown, orgId?: string | null): Promise<ImportResult> {
  return request<ImportResult>('/import', {
    method: 'POST',
    body: JSON.stringify({ format: 'toby', data, orgId: orgId || undefined }),
  });
}

// Export
export interface ExportData {
  version: 1;
  exportedAt: string;
  spaces: Array<{
    name: string;
    icon: string;
    orderIndex: number;
    collections: Array<{
      name: string;
      icon: string;
      color: string;
      orderIndex: number;
      bookmarks: Array<{
        title: string;
        url: string;
        description: string | null;
        favicon: string | null;
        tags: string[];
        orderIndex: number;
      }>;
    }>;
  }>;
}

export async function exportData(orgId?: string | null): Promise<ExportData> {
  const allSpaces = await getSpaces(orgId);
  const exportSpaces: ExportData['spaces'] = [];

  for (const space of allSpaces) {
    const cols = await getCollections(space.id);
    const byCollection = await getBookmarksBySpace(space.id);
    const exportCols: ExportData['spaces'][0]['collections'] = [];

    for (const col of cols) {
      const bks = byCollection[col.id] || [];
      exportCols.push({
        name: col.name,
        icon: col.icon,
        color: col.color,
        orderIndex: col.orderIndex,
        bookmarks: bks.map((b) => ({
          title: b.title,
          url: b.url,
          description: b.description,
          favicon: b.favicon,
          tags: b.tags,
          orderIndex: b.orderIndex,
        })),
      });
    }

    exportSpaces.push({
      name: space.name,
      icon: space.icon,
      orderIndex: space.orderIndex,
      collections: exportCols,
    });
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    spaces: exportSpaces,
  };
}

export async function importNative(data: ExportData, orgId?: string | null): Promise<ImportResult> {
  return request<ImportResult>('/import', {
    method: 'POST',
    body: JSON.stringify({ format: 'native', data, orgId: orgId || undefined }),
  });
}

// Members
export interface SpaceMember {
  userId: string;
  email: string;
  name: string;
  role: string;
  createdAt?: string;
}

export async function getSpaceMembers(spaceId: string): Promise<{ owner: { id: string; email: string; name: string }; members: SpaceMember[] }> {
  return request(`/members/${spaceId}`);
}

export async function addSpaceMember(spaceId: string, email: string, role: 'editor' | 'viewer' = 'viewer'): Promise<SpaceMember> {
  const data = await request<{ member: SpaceMember }>(`/members/${spaceId}`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  return data.member;
}

export async function updateMemberRole(spaceId: string, memberId: string, role: 'editor' | 'viewer'): Promise<void> {
  await request(`/members/${spaceId}/${memberId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function removeSpaceMember(spaceId: string, memberId: string): Promise<void> {
  await request(`/members/${spaceId}/${memberId}`, { method: 'DELETE' });
}
