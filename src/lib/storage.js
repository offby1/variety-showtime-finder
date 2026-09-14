// Saved-item storage. Lives in chrome.storage.sync (not .local), one entry
// per saved item under its own key (`saved:${item.key}`), rather than one
// big array under a single key - chrome.storage.sync caps a single item's
// value at 8KB, which a growing array of saved items would eventually
// exceed and start silently failing to write past. Keeping each item under
// its own key means each one only needs to fit under that cap
// individually (comfortably true for one movie/show's worth of data), and
// the real ceiling becomes sync's ~512-total-items / ~100KB-total-quota
// limits instead - both generous for a personal watch list.
//
// chrome.storage.sync (rather than .local) is used so this data survives
// uninstalling/reinstalling the extension and follows the user's
// Chrome-signed-in account. If Chrome sync isn't set up, this API still
// works as local-only storage - it just won't literally sync anywhere.
//
// Settings (src/options.js) live under a single "settings" key in the same
// storage area - small enough that the per-item-key concern doesn't apply.
//
// Shape of a saved item:
// {
//   key,            // `${mediaType}:${tmdbId}`
//   mediaType,      // "movie" | "tv"
//   tmdbId,
//   title,
//   year,
//   posterUrl,
//   sourceUrl,      // Variety review URL this was saved from, or null
//   savedAt,        // ISO timestamp
//   lastCheckedAt,  // ISO timestamp or null
//   streaming,      // last known TMDB watch-providers result, or null
//   theatrical,     // last known Fandango theatrical-status result
//                    // (movies only), or null
//   available,      // whether it was streaming OR in theaters as of
//                    // lastCheckedAt
//   newlyAvailable, // true if a recheck flipped available false -> true,
//                   // and it hasn't been viewed in the full list yet
// }

import { getWatchProviders } from "./tmdb.js";
import { getTheatricalStatus } from "./fandango.js";

const ITEM_PREFIX = "saved:";

function isAvailable(streaming, theatrical) {
  const streamingAvailable = Boolean(streaming?.flatrate?.length);
  const inTheaters = Boolean(theatrical?.found && theatrical.isReleaseInFuture === false);
  return streamingAvailable || inTheaters;
}

export function itemKey(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

export async function getSavedItems() {
  const all = await chrome.storage.sync.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(ITEM_PREFIX))
    .map((k) => all[k]);
}

async function putItem(item) {
  await chrome.storage.sync.set({ [ITEM_PREFIX + item.key]: item });
}

export async function isSaved(mediaType, tmdbId) {
  const storageKey = ITEM_PREFIX + itemKey(mediaType, tmdbId);
  const stored = await chrome.storage.sync.get(storageKey);
  return Boolean(stored[storageKey]);
}

export async function saveItem({
  mediaType,
  tmdbId,
  title,
  year,
  posterUrl,
  sourceUrl,
  streaming,
  theatrical,
}) {
  if (await isSaved(mediaType, tmdbId)) return;

  const now = new Date().toISOString();
  await putItem({
    key: itemKey(mediaType, tmdbId),
    mediaType,
    tmdbId,
    title,
    year,
    posterUrl,
    sourceUrl: sourceUrl || null,
    savedAt: now,
    lastCheckedAt: streaming || theatrical ? now : null,
    streaming: streaming || null,
    theatrical: theatrical || null,
    available: isAvailable(streaming, theatrical),
    newlyAvailable: false,
  });
}

export async function removeItem(key) {
  await chrome.storage.sync.remove(ITEM_PREFIX + key);
}

async function updateItemStatus(key, { streaming, theatrical }) {
  const storageKey = ITEM_PREFIX + key;
  const stored = await chrome.storage.sync.get(storageKey);
  const item = stored[storageKey];
  if (!item) return;

  const wasAvailable = item.available;
  const nowAvailable = isAvailable(streaming, theatrical);
  await putItem({
    ...item,
    streaming,
    theatrical: theatrical !== undefined ? theatrical : item.theatrical,
    available: nowAvailable,
    lastCheckedAt: new Date().toISOString(),
    newlyAvailable: item.newlyAvailable || (!wasAvailable && nowAvailable),
  });
}

// Re-fetches streaming (and, for movies, theatrical) status for a saved
// item and updates storage. The two lookups are independent (different
// services), so a failure in one (e.g. an invalid/expired TMDB key)
// shouldn't prevent the other from running or from being saved - each
// failure is caught separately and reported back via streamingError /
// theatricalError, falling back to the item's last-known value.
export async function recheckItem(item, apiKey, region, zip) {
  let streaming = item.streaming;
  let streamingError = null;
  try {
    streaming = await getWatchProviders(apiKey, item.mediaType, item.tmdbId, region);
  } catch (err) {
    streamingError = err;
  }

  let theatrical = item.theatrical;
  let theatricalError = null;
  if (item.mediaType === "movie") {
    try {
      theatrical = await getTheatricalStatus(item.title, item.year, zip);
    } catch (err) {
      theatricalError = err;
    }
  }

  await updateItemStatus(item.key, { streaming, theatrical });
  return { streaming, theatrical, streamingError, theatricalError };
}

// Clears the newlyAvailable flag on every saved item (called when the full
// list view is opened, since that's where "what's new" gets seen).
export async function clearNewlyAvailable() {
  const items = await getSavedItems();
  const updates = {};
  for (const item of items) {
    if (item.newlyAvailable) {
      updates[ITEM_PREFIX + item.key] = { ...item, newlyAvailable: false };
    }
  }
  if (Object.keys(updates).length) {
    await chrome.storage.sync.set(updates);
  }
}

// Dumps the entire sync storage area (every saved item plus "settings") for
// a manual backup/restore - see src/list.js's Export/Import buttons. Useful
// as a safety net across anything that can orphan chrome.storage.sync data,
// e.g. an unpacked extension's ID changing because it was reloaded from a
// different path, or a new manifest "key" changing it deliberately.
export async function exportAllData() {
  return chrome.storage.sync.get(null);
}

// Merges a previously-exported dump back into sync storage. This only adds/
// overwrites the keys present in `data` - it won't remove items that exist
// now but weren't in the dump.
export async function importAllData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Not a valid backup file");
  }
  await chrome.storage.sync.set(data);
}

// One-time migration from the pre-sync chrome.storage.local layout (a
// single "savedItems" array key, plus "settings") to the current
// chrome.storage.sync per-item layout, for anyone who already had data
// saved locally before this switch. Safe to call on every startup - it
// only ever fills in sync data that doesn't already exist, never
// overwrites, and leaves the old local data in place rather than deleting
// it (harmless if unused, and a safety net if something above is wrong).
export async function migrateFromLocalStorage() {
  const local = await chrome.storage.local.get(["savedItems", "settings"]);

  if (Array.isArray(local.savedItems) && local.savedItems.length) {
    const existing = await getSavedItems();
    if (!existing.length) {
      const updates = {};
      for (const item of local.savedItems) {
        updates[ITEM_PREFIX + item.key] = item;
      }
      await chrome.storage.sync.set(updates);
    }
  }

  if (local.settings) {
    const { settings: existingSettings } = await chrome.storage.sync.get("settings");
    if (!existingSettings) {
      await chrome.storage.sync.set({ settings: local.settings });
    }
  }
}
