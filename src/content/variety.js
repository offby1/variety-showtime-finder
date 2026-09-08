// Runs on variety.com pages. Detects review pages and reports the reviewed
// title (and, where determinable, whether it's a movie or TV show) to the
// background service worker, which lights up the toolbar icon. Also shows
// an on-page banner (styling in variety-banner.css) - the toolbar badge
// alone turned out to be too easy to miss, especially since the icon isn't
// even visible unless the user has pinned it (confirmed by real usage: the
// badge was there but went unnoticed).

// Variety doesn't consistently publish reviews under a /review(s)/ URL
// path - confirmed live: a real review ('Pressure' Review: Andrew Scott
// and Brendan Fraser Go Toe-to-Toe) lived at .../film/news/... instead of
// .../film/reviews/.... The title format is far more reliable than the
// URL, so check that first; the path check stays as a fallback in case a
// review's title ever doesn't happen to include "Review:" for some reason.
function isReviewPage() {
  return /\bReview:/i.test(document.title) || /\/reviews?\//.test(location.pathname);
}

function detectMediaType() {
  if (/\/tv\//.test(location.pathname)) return "tv";
  if (/\/film\//.test(location.pathname)) return "movie";
  return null;
}

// Variety's <title> tag consistently looks like:
//   ‘Movie Title’ Review: Some description of the film...
// og:title is NOT used here even though it's usually present too: it's a
// separate social-headline field that doesn't follow this pattern
// reliably - sometimes it embeds the title mid-sentence instead, e.g. for
// one review og:title was "Guy Ritchie’s ‘Young Sherlock’ Delivers a
// Perfect Origin Story: TV Review" while <title> was the expected
// "‘Young Sherlock’ Review: ..." (confirmed live).
//
// " Review" is a reliable anchor, so split on that first and *then* strip
// a wrapping quote pair from what's left, rather than searching for "the
// next quote-like character" to find the title's closing quote. The
// latter breaks on any title containing an apostrophe, since Variety
// reuses the same quote character for both a possessive apostrophe and
// the title's own closing quote (confirmed live - "‘Joe’s College Road
// Trip’ Review: ..." parsed as just "Joe", since the apostrophe in
// "Joe’s" matched as if it were the closing quote).
function extractTitle() {
  const raw = document.title || document.querySelector('meta[property="og:title"]')?.content || "";

  const withoutSuffix = raw.split(/\s+Review\b/i)[0].trim();
  return stripWrappingQuotes(withoutSuffix);
}

function stripWrappingQuotes(str) {
  const OPENERS = "‘'\"“";
  const CLOSERS = "’'\"”";
  const first = str[0];
  const last = str[str.length - 1];
  if (str.length >= 2 && OPENERS.includes(first) && CLOSERS.includes(last)) {
    return str.slice(1, -1).trim();
  }
  return str;
}

// True when `err` is Chrome's "Extension context invalidated" error: this
// content script instance was injected before the extension was last
// reloaded/reinstalled, and the tab it's running in was never refreshed
// afterward, so its connection to the (now-replaced) extension is gone.
// Expected and harmless during development (reload the extension, forget
// to also reload open tabs) - not a real bug, so it's worth distinguishing
// from one.
function isContextInvalidated(err) {
  return String(err?.message || err).includes("Extension context invalidated");
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
    try {
      const url = new URL(chrome.runtime.getURL("src/popup.html"));
      url.searchParams.set("title", title);
      if (tabId != null) url.searchParams.set("sourceTabId", tabId);
      window.open(url.toString(), "_blank");
    } catch (err) {
      if (!isContextInvalidated(err)) throw err;
      text.textContent = "Extension was updated — refresh this page and click again.";
      closeButton.remove();
    }
  });
}

async function detectAndReport() {
  if (!isReviewPage()) return;
  const title = extractTitle();
  if (!title) return;

  let tabId;
  try {
    tabId = await chrome.runtime.sendMessage({
      type: "VARIETY_REVIEW_DETECTED",
      payload: {
        title,
        mediaType: detectMediaType(),
        url: location.href,
      },
    });
  } catch (err) {
    if (isContextInvalidated(err)) return; // nothing useful to do; see above
    throw err;
  }

  showBanner(title, tabId);
}

detectAndReport();
