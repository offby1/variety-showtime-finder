// Thin wrapper around the parts of the TMDB API this extension uses.
// https://developer.themoviedb.org/reference/intro/getting-started

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w200";
const LOGO_BASE_URL = "https://image.tmdb.org/t/p/w45";

async function tmdbFetch(path, apiKey, params = {}) {
  const url = new URL(BASE_URL + path);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDB request failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

function normalizeResult(r) {
  const isMovie = r.media_type === "movie";
  const dateStr = isMovie ? r.release_date : r.first_air_date;
  return {
    id: r.id,
    mediaType: r.media_type,
    title: isMovie ? r.title : r.name,
    year: dateStr ? dateStr.slice(0, 4) : "",
    releaseDate: dateStr || null,
    overview: r.overview || "",
    posterPath: r.poster_path || null,
    posterUrl: r.poster_path ? `${IMAGE_BASE_URL}${r.poster_path}` : null,
  };
}

function normalizeTitleForMatch(title) {
  return (title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (combining diacritical marks)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// 0-3: how closely a candidate's title matches the search query, ignoring
// case/punctuation/accents. Deliberately coarse buckets (exact / prefix /
// substring / no match) rather than a fuzzy edit-distance score - good
// enough to separate "the movie" from "an unrelated movie that happens to
// share a word," which is what actually matters for ranking.
export function titleMatchScore(candidateTitle, query) {
  const a = normalizeTitleForMatch(candidateTitle);
  const b = normalizeTitleForMatch(query);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.startsWith(b) || b.startsWith(a)) return 2;
  if (a.includes(b) || b.includes(a)) return 1;
  return 0;
}

// 0-1: how close a candidate's release date is to a reference date
// (typically the Variety review's publish date), decaying with distance -
// full credit at 0 days apart, roughly half credit at a year apart. 0 if
// either date is missing/unparseable (neutral, not a penalty).
function dateProximityScore(candidateDateStr, referenceDateStr) {
  if (!candidateDateStr || !referenceDateStr) return 0;
  const candidate = Date.parse(candidateDateStr);
  const reference = Date.parse(referenceDateStr);
  if (Number.isNaN(candidate) || Number.isNaN(reference)) return 0;
  const daysApart = Math.abs(candidate - reference) / 86400000;
  return 1 / (1 + daysApart / 365);
}

// Ranks results so the most likely match for a review appears first:
// title-match closeness dominates (weighted ×10, vs. date score's 0-1
// range), so it always wins between different title-match buckets: date
// proximity only breaks ties *within* a bucket - e.g. among several
// exact-title matches (a franchise, a remake), the one released closest
// to when the review was published. referenceDate is optional; without
// it, ranking falls back to title match alone.
function rankResults(results, query, referenceDate) {
  return results
    .map((result) => ({
      result,
      score: titleMatchScore(result.title, query) * 10 + dateProximityScore(result.releaseDate, referenceDate),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ result }) => result);
}

// Searches both movies and TV shows for a title, ranked so the most
// likely match (see rankResults) appears first. referenceDate (optional)
// is typically the Variety review's publish date.
export async function searchTitles(apiKey, query, referenceDate) {
  const data = await tmdbFetch("/search/multi", apiKey, {
    query,
    include_adult: "false",
  });
  const results = (data.results || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map(normalizeResult);
  return rankResults(results, query, referenceDate);
}

// Returns { region, link, flatrate, rent, buy } for the given title in the
// given region (ISO 3166-1 country code, e.g. "US"). Arrays are empty and
// link is null when there's no data for that region.
export async function getWatchProviders(apiKey, mediaType, id, region) {
  const path = mediaType === "movie" ? `/movie/${id}/watch/providers` : `/tv/${id}/watch/providers`;
  const data = await tmdbFetch(path, apiKey, {});
  const byRegion = (data.results || {})[region];
  if (!byRegion) {
    return { region, link: null, flatrate: [], rent: [], buy: [] };
  }
  return {
    region,
    link: byRegion.link || null,
    flatrate: byRegion.flatrate || [],
    rent: byRegion.rent || [],
    buy: byRegion.buy || [],
  };
}

export function providerLogoUrl(logoPath) {
  return logoPath ? `${LOGO_BASE_URL}${logoPath}` : null;
}
