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
  and the popup pre-fills with the reviewed title.
- Click the icon anywhere else to search manually or view your saved list.
- "View all" in the popup opens the full saved-list page.

## Updating after code changes

Go to `chrome://extensions` and click the reload icon on this extension's
card (or toggle it off/on) to pick up any file changes.
