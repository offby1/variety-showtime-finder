// Runs on fandango.com pages. Only does anything on a page the background
// service worker opened specifically for scraping (flagged via the
// `_ext_scrape` query param - see movieTimesScrapeUrl() in
// src/lib/fandango.js) - a plain visit to Fandango by the user is a no-op.
// Relying on that marker alone (rather than also matching a specific path)
// is deliberate: Fandango had a separate /movietimes route that, mid-way
// through development, started 301-redirecting to /movie-overview (same
// content, same showtimes widget) - matching only the query param we
// control means this doesn't care which path Fandango lands us on.
//
// Per-theater showtimes are loaded by Fandango's own client-side JS after
// the page renders, so this polls for that to finish rather than reading
// anything from the initial DOMContentLoaded state. Verified against a live
// render (via Playwright, during development) that each theater's showtimes
// are embedded as JSON in a `data-amenity-group` attribute on
// `button.js-amenity-btn` elements - far more reliable than parsing the
// visible time-pill text.

(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has("_ext_scrape")) return;

  const TIMEOUT_MS = 15000;
  const POLL_MS = 500;
  const start = Date.now();

  function extractTheaters() {
    const theaters = [];
    for (const theaterEl of document.querySelectorAll(".js-movie-showtime-theater")) {
      const nameLink = theaterEl.querySelector(".shared-theater-header__name-link");
      if (!nameLink) continue;

      const formats = [];
      for (const group of theaterEl.querySelectorAll(".shared-showtimes__amenity-group")) {
        const titleEl = group.querySelector(".shared-showtimes__title");
        const btn = group.querySelector(".js-amenity-btn[data-amenity-group]");
        if (!btn) continue;

        let data;
        try {
          data = JSON.parse(btn.dataset.amenityGroup);
        } catch {
          continue;
        }

        const times = (data.showtimes || [])
          .filter((s) => !s.isSoldOut && s.type !== "soldOut")
          .map((s) => ({ time: s.screenReaderTime || s.date, url: s.ticketingJumpPageURL || null }));

        if (times.length) {
          formats.push({ format: titleEl ? titleEl.textContent.trim() : "Standard", times });
        }
      }

      if (formats.length) {
        const distanceEl = theaterEl.querySelector(".shared-theater-header__distance");
        theaters.push({
          name: nameLink.textContent.trim(),
          url: nameLink.href || null,
          distance: distanceEl ? distanceEl.textContent.trim() : null,
          formats,
        });
      }
    }
    return theaters;
  }

  function attempt() {
    const stillLoading = document.querySelector(".showtimes-placeholder");
    const theaters = extractTheaters();
    const timedOut = Date.now() - start > TIMEOUT_MS;

    if (!stillLoading || theaters.length || timedOut) {
      chrome.runtime.sendMessage({
        type: "FANDANGO_SHOWTIMES_RESULT",
        payload: { theaters, timedOut: timedOut && theaters.length === 0 },
      });
      return;
    }
    setTimeout(attempt, POLL_MS);
  }

  attempt();
})();
