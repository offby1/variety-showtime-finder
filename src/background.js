// Background service worker: tracks which tabs have a detected Variety
// review, lights up the toolbar icon for those tabs, and answers the
// popup's question of "what was detected on the active tab?".

const detectedByTab = new Map();

function lightUpTab(tabId, payload) {
  detectedByTab.set(tabId, payload);
  chrome.action.setBadgeText({ tabId, text: "•" }); // •
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#2a7a2a" });
  chrome.action.setTitle({ tabId, title: `Showtime Finder — detected: ${payload.title}` });
}

function clearTab(tabId) {
  detectedByTab.delete(tabId);
  chrome.action.setBadgeText({ tabId, text: "" });
  chrome.action.setTitle({ tabId, title: "Showtime Finder" });
}

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
