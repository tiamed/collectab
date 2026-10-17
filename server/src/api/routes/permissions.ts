import { and, eq } from 'drizzle-orm';
import { getDb } from '../../database/client.js';
import { organizations, spaceMembers } from '../../database/schema.js';

type Db = ReturnType<typeof getDb>;

export type SpaceRole = 'owner' | 'editor' | 'viewer';

export type SpaceRow = {
  id: string;
  ownerId: string;
  orgId: string | null;
};

/**
 * Resolve the caller's effective role for a space.
 *
 * Order:
 *  1. Personal space: ownerId match → owner; else space_members → editor/viewer/null
 *  2. Org space: org.ownerId match → owner (sees every space in the org)
 *  3. Space creator (ownerId) → owner
 *  4. space_members lookup → editor/viewer/null
 * Org admin/member with no space_members row has no access.
 */
export async function getEffectiveRole(
  db: Db,
  space: SpaceRow | null | undefined,
  userId: string,
): Promise<SpaceRole | null> {
  if (!space) return null;

  // Personal spaces: never query org membership
  if (!space.orgId) {
    if (space.ownerId === userId) return 'owner';
    const [sm] = await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
    if (!sm) return null;
    if (sm.role === 'owner' || sm.role === 'editor' || sm.role === 'viewer') {
      return sm.role as SpaceRole;
    }
    return null;
  }

  // Org space: org owner is supreme across all org spaces
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, space.orgId));
  if (org?.ownerId === userId) return 'owner';

  // Space creator is always owner
  if (space.ownerId === userId) return 'owner';

  const [sm] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, userId)));
  if (!sm) return null;
  if (sm.role === 'owner' || sm.role === 'editor' || sm.role === 'viewer') {
    return sm.role as SpaceRole;
  }
  return null;
}

export async function isSpaceOwner(
  db: Db,
  space: SpaceRow | null | undefined,
  userId: string,
): Promise<boolean> {
  return (await getEffectiveRole(db, space, userId)) === 'owner';
}

/** owner | editor may mutate collections/bookmarks */
export async function canEditSpace(
  db: Db,
  space: SpaceRow | null | undefined,
  userId: string,
): Promise<boolean> {
  const role = await getEffectiveRole(db, space, userId);
  return role === 'owner' || role === 'editor';
}

/** Any non-null space role may list/read the space. */
export async function hasSpaceAccess(
  db: Db,
  space: SpaceRow | null | undefined,
  userId: string,
): Promise<boolean> {
  return (await getEffectiveRole(db, space, userId)) !== null;
}
