# Variety Showtime Finder — Chrome Extension Plan

## Problem

Variety.com movie/TV reviews don't say when/where you can actually watch the
thing. This extension detects when you're reading a Variety review, looks up
streaming and (for movies) theatrical availability, and lets you save titles
to check on again later.

## Scope decisions

- **Movies and TV shows** both supported. TV shows get streaming info only
  (no theatrical showtimes, since that doesn't apply).
- **Personal use only.** Loaded unpacked via `chrome://extensions` developer
  mode — not published to the Chrome Web Store.
- **Pure client-side extension.** No backend server. All API calls and
  scraping happen from the extension itself (background service worker /
  background tab + content script). Saved list and settings live in
  `chrome.storage`.
- **Recheck is on-demand**, not scheduled — there's no backend to poll in
  the background on a timer. A badge count highlights items whose status
  has changed to "available" since you last looked, so you don't have to
  remember to check each one individually.

## Data sources

- **Streaming availability:** [TMDB API](https://www.themoviedb.org/documentation/api)
  (free API key). Its "watch providers" endpoint is sourced from JustWatch
  data and gives per-region streaming/rental/purchase availability. TMDB
  search (`/search/multi` or separate movie/tv search) is also used to
  resolve a Variety review's title to a canonical TMDB id, disambiguating
  by year/type when there are multiple matches.
- **Theatrical showtimes (movies only):** scraped from **Fandango**
  (title + zip code search). Chosen over scraping Google's showtimes panel
  because Fandango's pages are meant for humans, are much less aggressive
  about bot detection, and are more durable for occasional personal use.
  No official API exists for either service, and paid theatrical-data APIs
  (MovieGlu, Gracenote/TMS, SerpApi) were ruled out to avoid recurring cost
  and/or B2B signup friction for a personal tool.
  - Mechanically: the background service worker opens a background tab to
    the relevant Fandango search/movie page, lets it load normally (real
    rendering, not a bare HTTP fetch, to look like normal browsing and
    reduce bot-detection risk), a content script reads showtimes/theater
    data out of the rendered DOM, then the tab is closed and the result is
    returned.

## Components

1. **Content script — Variety review detector** (`variety.com/*`)
   - Detects review pages (URL pattern `/review/...` and/or page template
     markers), extracts title, content type (movie/TV), and any
     disambiguating info on the page (year, cast, director).
   - Messages the background worker, which lights up the toolbar icon for
     that tab.

2. **Background service worker — data aggregation**
   - Resolves title → TMDB id via search (disambiguating when needed).
   - Fetches TMDB watch-provider data for streaming availability.
   - For movies: runs the Fandango background-tab scrape for theatrical
     status/showtimes.
   - Merges into one status object per title and updates `chrome.storage`.
   - Tracks available/unavailable transitions per saved item and maintains
     the badge count of newly-available items.

3. **Popup UI**
   - Always accessible via the toolbar icon on any page (not just Variety
     reviews) — this was a key point to get right, since a popup that only
     works on Variety pages would be easy to forget about.
   - On a Variety review tab: shows the resolved title with a "Get showtime
     info" button (streaming + theatrical) and a "Save for later" button.
   - On any other page: shows a compact view of the saved list, plus a link
     to the full-page list view.

4. **Full-page list view** (`list.html`, opens in its own tab)
   - Table/grid of all saved items: title, poster, streaming providers,
     theatrical status, date saved.
   - Sort, delete, and per-item "Recheck" controls.
   - Viewing this clears the "newly available" badge count.

5. **Storage** (`chrome.storage.local`, or `.sync` if desired later)
   - Saved items: title, TMDB id/type, source review URL, date saved, last
     known status (streaming providers, theatrical status), availability
     flag used for badge tracking.
   - Settings: TMDB API key, zip code (for Fandango searches).

6. **Options page**
   - Form for TMDB API key and zip code.

## Known fragility (accepted tradeoffs)

- Fandango scraping breaks if their page structure changes — no SLA, no
  advance notice. Expect occasional maintenance.
- Title matching (Variety title → TMDB entry) can mis-resolve for ambiguous
  titles/remakes; may need a manual disambiguation picker in the popup when
  TMDB returns multiple plausible matches.
- No push notifications — badge count only updates when a recheck runs, and
  rechecks are user-triggered, not scheduled.

## Build order

1. TMDB integration + popup lookup UI (title → streaming info) — core value
   fastest.
2. Variety content-script detection + icon lighting.
3. Save/recheck list, storage, and badge count.
4. Full-page list view.
5. Fandango scraping for theatrical status (riskiest, most fiddly — saved
   for last).
