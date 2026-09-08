// Runs on variety.com pages. Detects review pages and reports the reviewed
// title (and, where determinable, whether it's a movie or TV show) to the
// background service worker, which lights up the toolbar icon.

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

function detectAndReport() {
  if (!isReviewPage()) return;
  const title = extractTitle();
  if (!title) return;

  chrome.runtime.sendMessage({
    type: "VARIETY_REVIEW_DETECTED",
    payload: {
      title,
      mediaType: detectMediaType(),
      url: location.href,
    },
  });
}

detectAndReport();
