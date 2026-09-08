// Background service worker: tracks which tabs have a detected Variety
// review, lights up the toolbar icon for those tabs, answers the popup's
// question of "what was detected on the active tab?", and orchestrates the
// background-tab scrape of live Fandango showtimes (see
// src/content/fandango-showtimes.js for why this needs a real rendered tab
// rather than a plain fetch).

import { movieTimesScrapeUrl } from "./lib/fandango.js";

const detectedByTab = new Map();
const BADGE_COLOR = "#2a7a2a";
const SHOWTIMES_TAB_TIMEOUT_MS = 20000;

const pendingShowtimeRequests = new Map(); // tabId -> { resolve, timeoutId }

// Opens a background (non-active) tab to Fandango's movietimes page for
// `slug`/`zip`, waits for src/content/fandango-showtimes.js to report back
// what it scraped, then closes the tab. Resolves to { theaters, timedOut }
// even on failure/timeout - this is a best-effort feature and callers
// shouldn't need to handle rejections.
async function fetchLiveShowtimes(slug, zip) {
  const url = movieTimesScrapeUrl(slug, zip);
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (err) {
    return { theaters: [], timedOut: false, error: String(err) };
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingShowtimeRequests.delete(tab.id);
      chrome.tabs.remove(tab.id).catch(() => {});
      resolve({ theaters: [], timedOut: true });
    }, SHOWTIMES_TAB_TIMEOUT_MS);

    pendingShowtimeRequests.set(tab.id, { resolve, timeoutId });
  });
}

function lightUpTab(tabId, payload) {
  detectedByTab.set(tabId, payload);
  chrome.action.setBadgeText({ tabId, text: "•" });
  chrome.action.setTitle({ tabId, title: `Showtime Finder — detected: ${payload.title}` });
}

function clearTab(tabId) {
  detectedByTab.delete(tabId);
  // Passing "" clears this tab's badge-text override, so the tab falls
  // back to showing the global default (the newly-available count, if any).
  chrome.action.setBadgeText({ tabId, text: "" });
  chrome.action.setTitle({ tabId, title: "Showtime Finder" });
}

// The global (non-tab-specific) badge shows how many saved items have
// newly become available since the full list view was last opened.
function updateGlobalBadge(savedItems) {
  const count = (savedItems || []).filter((i) => i.newlyAvailable).length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

chrome.storage.local.get("savedItems").then(({ savedItems }) => updateGlobalBadge(savedItems));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.savedItems) {
    updateGlobalBadge(changes.savedItems.newValue);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "VARIETY_REVIEW_DETECTED" && sender.tab?.id != null) {
    lightUpTab(sender.tab.id, message.payload);
    return;
  }

  if (message?.type === "GET_DETECTED_REVIEW") {
    sendResponse(detectedByTab.get(message.tabId) || null);
    return;
  }

  if (message?.type === "FANDANGO_SHOWTIMES_RESULT" && sender.tab?.id != null) {
    const pending = pendingShowtimeRequests.get(sender.tab.id);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingShowtimeRequests.delete(sender.tab.id);
      pending.resolve(message.payload);
    }
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    return;
  }

  if (message?.type === "GET_LIVE_SHOWTIMES") {
    fetchLiveShowtimes(message.slug, message.zip).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  detectedByTab.delete(tabId);

  const pending = pendingShowtimeRequests.get(tabId);
  if (pending) {
    clearTimeout(pending.timeoutId);
    pendingShowtimeRequests.delete(tabId);
    pending.resolve({ theaters: [], timedOut: false, closed: true });
  }
});

// A new navigation on a tab invalidates any previous detection until the
// content script (re-)reports on whatever page loads next.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearTab(tabId);
  }
});
