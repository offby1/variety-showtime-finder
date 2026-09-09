// Best-effort integration with Fandango's public website for theatrical
// release status. Fandango has no official API, so this works against
// their normal, human-facing pages:
//
//   1. https://www.fandango.com/search?q=<title>&mode=movies is
//      server-rendered HTML (confirmed by inspection) - safe to fetch()
//      directly and parse. Used to resolve a title to Fandango's own
//      movie slug/id.
//   2. https://www.fandango.com/<slug>/movie-overview is also
//      server-rendered, and has a `root.Fandango.movieDetails = {...};`
//      JSON blob inline in a <script> tag with release date / release
//      status - reliable to extract without executing any JS.
//
// Deliberately NOT scraped here: per-theater showtimes for a given zip
// code. Fandango loads that part of the page asynchronously via
// client-side JS after the page renders - even the movie-overview and
// movietimes pages for a movie currently in wide release only contain an
// empty placeholder in the raw HTML. Reproducing that would require
// actually rendering the page (a background tab + content script reading
// the live DOM) against selectors that can't be verified without a real
// browser. Instead, getTheatricalStatus() below returns a direct link to
// Fandango's own showtimes page (pre-filled with title + zip) so the user
// sees Fandango's real, live listing with one click.
//
// Parsing is done with regexes rather than DOMParser so this module works
// from a background service worker (which has no DOM) as well as from
// extension pages.

import { titleMatchScore } from "./tmdb.js";

const SEARCH_URL = "https://www.fandango.com/search";

function movieUrl(slug) {
  return `https://www.fandango.com/${slug}/movie-overview`;
}

// Fandango used to have a separate /movietimes route for a movie's
// showtimes; as of this writing it 301s straight to /movie-overview (with
// the same ?zipcode= param) for every movie, which renders the identical
// showtimes widget - confirmed live, mid-development, when /movietimes
// suddenly started redirecting. Building the URL directly avoids depending
// on that redirect (and, if Fandango ever restores /movietimes as a
// separate page, this still works since it's the same content either way).
export function movieTimesUrl(slug, zip) {
  const url = new URL(movieUrl(slug));
  if (zip) url.searchParams.set("zipcode", zip);
  return url.toString();
}

// Same URL, but flagged for src/content/fandango-showtimes.js to scrape.
// Kept separate from movieTimesUrl() so a plain "open this in a real tab"
// link never accidentally triggers scraping.
const SCRAPE_MARKER = "_ext_scrape";

export function movieTimesScrapeUrl(slug, zip) {
  const url = new URL(movieTimesUrl(slug, zip));
  url.searchParams.set(SCRAPE_MARKER, "1");
  return url.toString();
}

export function isScrapeRequestUrl(urlString) {
  try {
    return new URL(urlString).searchParams.has(SCRAPE_MARKER);
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Fandango request failed (${res.status})`);
  return res.text();
}

// Searches Fandango's movie catalog by title. Returns candidates
// (Fandango's own relevance order) as { title, slug, year }.
export async function searchFandangoMovies(title) {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(title)}&mode=movies`;
  const html = await fetchText(url);

  const results = [];
  const linkPattern = /<a class="[^"]*\bsearch__movie-title\b[^"]*"\s+href="([^"]+)">([^<]*)<\/a>/g;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].trim();
    const slug = href.replace(/^\//, "").replace(/\/movie-overview\/?$/, "");
    const yearMatch = text.match(/\((\d{4})\)\s*$/);
    results.push({
      title: yearMatch ? text.slice(0, yearMatch.index).trim() : text,
      slug,
      year: yearMatch ? yearMatch[1] : null,
    });
  }
  return results;
}

// Pulls release-status details out of a movie-overview page's embedded
// `root.Fandango.movieDetails` JSON. Returns null if the page didn't have
// the expected data (structure changed, or a network/parse error).
export async function getFandangoMovieDetails(slug) {
  const html = await fetchText(movieUrl(slug));
  const match = html.match(/root\.Fandango\.movieDetails\s*=\s*(\{.*?\});/s);
  if (!match) return null;
  try {
    // This blob is embedded as a JS object literal, not strict JSON - some
    // fields are serialized as the bare token `undefined` (verified against
    // a live fetch), which JSON.parse rejects.
    const sanitized = match[1].replace(/:\s*undefined\b/g, ": null");
    return JSON.parse(sanitized);
  } catch {
    return null;
  }
}

// Combines search + detail lookup into one theatrical-status result.
// Never throws for "expected" failure modes (no match, page shape
// changed) - callers get { found: false } instead, since this is a
// best-effort feature and shouldn't break the rest of the popup/list UI.
export async function getTheatricalStatus(title, year, zip) {
  let candidates;
  try {
    candidates = await searchFandangoMovies(title);
  } catch {
    return { found: false, error: true };
  }
  if (!candidates.length) {
    return { found: false };
  }

  // Prefer an exact title match before falling back to year: Fandango's
  // own top/best-relevance result for a title often has no year suffix in
  // its listing text (verified live), so matching on year first can skip
  // right past the correct entry and land on an unrelated "Double
  // Feature: X / Y (<year>)" bundle listing instead.
  const normalizedQuery = title.trim().toLowerCase();
  const exactTitleMatch = candidates.find((c) => c.title.trim().toLowerCase() === normalizedQuery);
  const yearMatch = year && candidates.find((c) => c.year === String(year));
  // Fandango's own search is a loose substring match, not a "results about
  // this title" search - confirmed live: searching "Musk" (a 2026
  // documentary Fandango doesn't carry at all) returned "The Musketeer" (an
  // unrelated 2001 film) as its own top result, purely because "musk" is a
  // substring of "musketeer". Blindly trusting candidates[0] as a
  // last-resort fallback picked that unrelated film and sent the user's
  // live-showtimes scrape to its page. Require at least a prefix-level
  // match (titleMatchScore >= 2, i.e. one title starts with the other) for
  // the fallback - a bare substring hit isn't good enough to trust
  // unsupervised.
  const fallback = titleMatchScore(candidates[0].title, title) >= 2 ? candidates[0] : null;
  const best = exactTitleMatch || yearMatch || fallback;
  if (!best) {
    return { found: false };
  }

  let details = null;
  try {
    details = await getFandangoMovieDetails(best.slug);
  } catch {
    // Fall through - we still have the search match and can link out.
  }

  return {
    found: true,
    slug: best.slug,
    fandangoTitle: best.title,
    fandangoUrl: movieUrl(best.slug),
    showtimesUrl: movieTimesUrl(best.slug, zip),
    releaseDate: details?.releaseDate || null,
    releaseDateQueryParam: details?.releaseDateQueryParam || null,
    isReleaseInFuture: details?.isReleaseInFuture ?? null,
  };
}
