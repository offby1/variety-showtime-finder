// Background service worker: tracks which tabs have a detected Variety
// review, lights up the toolbar icon for those tabs, and answers the
// popup's question of "what was detected on the active tab?".

const detectedByTab = new Map();
const BADGE_COLOR = "#2a7a2a";

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
});

chrome.tabs.onRemoved.addListener((tabId) => {
  detectedByTab.delete(tabId);
});

// A new navigation on a tab invalidates any previous detection until the
// content script (re-)reports on whatever page loads next.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearTab(tabId);
  }
});
