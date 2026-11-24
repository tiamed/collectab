/**
 * Description values on the bookmark JSON API.
 *
 * `JSON.stringify` omits keys whose value is `undefined`, and the update route
 * treats a missing `description` as "leave unchanged". Clearing a description
 * has to send `null` (stored as SQL NULL). A blank create is omitted; the
 * create route already stores that as null.
 */

export function normalizeDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Create body. Blank is omitted so the server stores null. */
export function descriptionForCreate(value: string | null | undefined): string | undefined {
  return normalizeDescription(value) ?? undefined;
}

/**
 * Update body.
 * `undefined` — this update does not include description.
 * `null` — clear the stored description.
 * string — replace it.
 */
export function descriptionForUpdate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return normalizeDescription(value);
}
