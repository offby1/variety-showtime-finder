// Runs on variety.com pages. Detects review pages and reports the reviewed
// title (and, where determinable, whether it's a movie or TV show) to the
// background service worker, which lights up the toolbar icon. Also shows
// an on-page banner (styling in variety-banner.css) - the toolbar badge
// alone turned out to be too easy to miss, especially since the icon isn't
// even visible unless the user has pinned it (confirmed by real usage: the
// badge was there but went unnoticed).

function isReviewPage() {
  return /\/reviews?\//.test(location.pathname);
}

function detectMediaType() {
  if (/\/tv\//.test(location.pathname)) return "tv";
  if (/\/film\//.test(location.pathname)) return "movie";
  return null;
}

// Variety review titles/og:title typically look like:
//   ‘Movie Title’ Review: Some description of the film...
// Pull out the quoted portion if present, otherwise fall back to stripping
// a trailing "Review: ..." suffix.
function extractTitle() {
  const og = document.querySelector('meta[property="og:title"]');
  const raw = og?.content || document.title || "";

  const quoted = raw.match(/[‘'"]([^’'"]+)[’'"]/);
  if (quoted) return quoted[1].trim();

  return raw.split(/\s+Review\b/i)[0].trim();
}

const BANNER_ID = "__showtime_finder_banner__";

function dismissalKey() {
  return `showtime-finder-dismissed:${location.href}`;
}

function showBanner(title, tabId) {
  if (document.getElementById(BANNER_ID)) return;
  if (sessionStorage.getItem(dismissalKey())) return;

  const banner = document.createElement("div");
  banner.id = BANNER_ID;

  const icon = document.createElement("span");
  icon.className = "sf-banner-icon";
  icon.textContent = "🎬";

  const text = document.createElement("span");
  text.className = "sf-banner-text";
  text.textContent = `Click for showtime info on "${title}"`;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "sf-banner-close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Dismiss");

  banner.append(icon, text, closeButton);
  document.body.appendChild(banner);

  closeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    sessionStorage.setItem(dismissalKey(), "1");
    banner.remove();
  });

  banner.addEventListener("click", () => {
    // Content scripts can't call chrome.action.openPopup() (it requires a
    // gesture the extension itself recognizes, not one relayed from a
    // page), so this opens the same popup.html as a regular tab instead -
    // same UI and logic, just not anchored to the toolbar icon.
    //
    // Popup.html normally figures out "what review is this?" by asking
    // the background worker about the active tab - but opened as a plain
    // tab, IT is the active tab, so that lookup would find nothing. Pass
    // both a fallback (title, so the search box is prefilled even if
    // something below fails) and the real source tab's id (so popup.js
    // can look up the full detected record - title, media type, review
    // URL - and behave exactly as it would from the toolbar icon,
    // including auto-running the search).
    const url = new URL(chrome.runtime.getURL("src/popup.html"));
    url.searchParams.set("title", title);
    if (tabId != null) url.searchParams.set("sourceTabId", tabId);
    window.open(url.toString(), "_blank");
  });
}

async function detectAndReport() {
  if (!isReviewPage()) return;
  const title = extractTitle();
  if (!title) return;

  const tabId = await chrome.runtime.sendMessage({
    type: "VARIETY_REVIEW_DETECTED",
    payload: {
      title,
      mediaType: detectMediaType(),
      url: location.href,
    },
  });

  showBanner(title, tabId);
}

detectAndReport();
