# Variety Showtime Finder

Chrome extension: detects when you're reading a Variety movie/TV review,
looks up where to stream it and (for movies) its theatrical status, and
lets you save titles to check again later. See [PLAN.md](PLAN.md) for the
full design.

## Install (unpacked, local only)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle, top right).
3. Click **Load unpacked**.
4. Select this project's folder (the one containing `manifest.json`).
5. The extension icon should now appear in your toolbar.

## First-time setup

1. Get a free TMDB API key: https://www.themoviedb.org/settings/api
   (use the "API Key (v3 auth)" value).
2. Click the extension icon → **Settings** (or right-click the icon →
   Options).
3. Enter your TMDB API key, region/country code (e.g. `US`), and zip code.
4. Click **Save**.

## Using it

- Visit a Variety review page (variety.com) — the toolbar icon lights up
  (a small dot badge) and the popup pre-fills with the reviewed title.
- Click the icon anywhere else to search manually or view your saved list.
- Click a search result to see streaming providers and, for movies,
  theatrical status — then **Save for later** to add it to your list.
- For a movie already in theaters, a **Show live showtimes here** button
  fetches real per-theater showtimes near your saved zip code (takes a
  few seconds — it briefly opens a background tab to Fandango to render
  them, then closes it).
- A numbered badge on the icon (distinct from the review-detected dot)
  shows how many saved titles have newly become available since you last
  opened the saved list; it clears once you open "view all".
- "View all" in the popup opens the full saved-list page, with sort,
  recheck, and remove controls, plus **Export backup** / **Import backup**
  buttons to save your saved list + settings to a JSON file and restore
  them later (e.g. after `chrome.storage.sync` data gets orphaned by an
  extension ID change).
- **Export HTML** saves a static, read-only snapshot of the currently
  sorted list as a standalone `.html` file — no extension or JS required
  to view it, just a browser. Handy for checking your list from a device
  that can't run this extension at all, like an iPhone (upload it to
  Google Drive, iCloud, email it to yourself, etc.). It's a point-in-time
  snapshot, not live — re-export and re-upload after making changes you
  want reflected there.

## Updating after code changes

Go to `chrome://extensions` and click the reload icon on this extension's
card (or toggle it off/on) to pick up any file changes.

## Testing notes

This was tested end-to-end against real variety.com and fandango.com pages
using a manually-installed Playwright/Chromium build (see PLAN.md), loading
the actual unpacked extension the same way `chrome://extensions` does.
Covered: Variety review detection and icon badge (including navigating
between a review, a non-review page, and a different review in the same
tab), TMDB-based search UI, save/recheck/badge-count logic (including a
failed TMDB lookup not blocking the independent Fandango check), Fandango
theatrical status matching, and the live-showtimes background-tab scrape.
Not testable without your own key: an actual TMDB search/streaming-lookup
result, since that requires a real API key entered in Settings.
