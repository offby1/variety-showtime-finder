// Saved-item storage. Items live in chrome.storage.local under "savedItems".
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

function isAvailable(streaming, theatrical) {
  const streamingAvailable = Boolean(streaming?.flatrate?.length);
  const inTheaters = Boolean(theatrical?.found && theatrical.isReleaseInFuture === false);
  return streamingAvailable || inTheaters;
}

const STORAGE_KEY = "savedItems";

export function itemKey(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

export async function getSavedItems() {
  const { [STORAGE_KEY]: items } = await chrome.storage.local.get(STORAGE_KEY);
  return items || [];
}

async function setSavedItems(items) {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

export async function isSaved(mediaType, tmdbId) {
  const items = await getSavedItems();
  return items.some((i) => i.key === itemKey(mediaType, tmdbId));
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
  const items = await getSavedItems();
  const key = itemKey(mediaType, tmdbId);
  if (items.some((i) => i.key === key)) return;

  const now = new Date().toISOString();
  items.push({
    key,
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
  await setSavedItems(items);
}

export async function removeItem(key) {
  const items = await getSavedItems();
  await setSavedItems(items.filter((i) => i.key !== key));
}

async function updateItemStatus(key, { streaming, theatrical }) {
  const items = await getSavedItems();
  const idx = items.findIndex((i) => i.key === key);
  if (idx === -1) return;

  const item = items[idx];
  const wasAvailable = item.available;
  const nowAvailable = isAvailable(streaming, theatrical);
  items[idx] = {
    ...item,
    streaming,
    theatrical: theatrical !== undefined ? theatrical : item.theatrical,
    available: nowAvailable,
    lastCheckedAt: new Date().toISOString(),
    newlyAvailable: item.newlyAvailable || (!wasAvailable && nowAvailable),
  };
  await setSavedItems(items);
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
  await setSavedItems(items.map((i) => (i.newlyAvailable ? { ...i, newlyAvailable: false } : i)));
}
