/** Cross-context signal: popup (or any page) → open newtab refreshes bookmarks. */

import { browser } from 'wxt/browser';

export const BOOKMARKS_CHANGED_KEY = 'bookmarks_changed_v1';

export type BookmarksChangedEvent = {
  at: number;
  spaceId?: string | null;
  collectionId?: string | null;
};

/** Bump a shared storage key so other extension pages can refetch. */
export async function notifyBookmarksChanged(
  event: Omit<BookmarksChangedEvent, 'at'> = {},
): Promise<void> {
  try {
    await browser.storage.local.set({
      [BOOKMARKS_CHANGED_KEY]: { ...event, at: Date.now() } satisfies BookmarksChangedEvent,
    });
  } catch {}
}

/** Subscribe to bookmark mutations from other extension pages. */
export function subscribeBookmarksChanged(
  listener: (event: BookmarksChangedEvent) => void,
): () => void {
  if (typeof browser === 'undefined' || !browser.storage?.onChanged) return () => {};

  const handler = (
    changes: { [key: string]: { newValue?: unknown; oldValue?: unknown } },
    areaName: string,
  ) => {
    if (areaName !== 'local') return;
    const change = changes[BOOKMARKS_CHANGED_KEY];
    if (!change?.newValue) return;
    listener(change.newValue as BookmarksChangedEvent);
  };

  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
