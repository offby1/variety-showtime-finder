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
//   available,      // whether it was streaming (flatrate) as of lastCheckedAt
//   newlyAvailable, // true if a recheck flipped available false -> true,
//                   // and it hasn't been viewed in the full list yet
// }

import { getWatchProviders } from "./tmdb.js";

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

export async function saveItem({ mediaType, tmdbId, title, year, posterUrl, sourceUrl, streaming }) {
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
    lastCheckedAt: streaming ? now : null,
    streaming: streaming || null,
    available: streaming ? streaming.flatrate.length > 0 : false,
    newlyAvailable: false,
  });
  await setSavedItems(items);
}

export async function removeItem(key) {
  const items = await getSavedItems();
  await setSavedItems(items.filter((i) => i.key !== key));
}

async function updateItemStreaming(key, streaming) {
  const items = await getSavedItems();
  const idx = items.findIndex((i) => i.key === key);
  if (idx === -1) return;

  const item = items[idx];
  const wasAvailable = item.available;
  const isAvailable = streaming.flatrate.length > 0;
  items[idx] = {
    ...item,
    streaming,
    available: isAvailable,
    lastCheckedAt: new Date().toISOString(),
    newlyAvailable: item.newlyAvailable || (!wasAvailable && isAvailable),
  };
  await setSavedItems(items);
}

// Re-fetches streaming status for a saved item and updates storage.
// Returns the fresh streaming result.
export async function recheckItem(item, apiKey, region) {
  const streaming = await getWatchProviders(apiKey, item.mediaType, item.tmdbId, region);
  await updateItemStreaming(item.key, streaming);
  return streaming;
}

// Clears the newlyAvailable flag on every saved item (called when the full
// list view is opened, since that's where "what's new" gets seen).
export async function clearNewlyAvailable() {
  const items = await getSavedItems();
  await setSavedItems(items.map((i) => (i.newlyAvailable ? { ...i, newlyAvailable: false } : i)));
}
