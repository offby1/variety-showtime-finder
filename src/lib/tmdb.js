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
    overview: r.overview || "",
    posterPath: r.poster_path || null,
    posterUrl: r.poster_path ? `${IMAGE_BASE_URL}${r.poster_path}` : null,
  };
}

// Searches both movies and TV shows for a title. Optionally narrow by year.
export async function searchTitles(apiKey, query, year) {
  const data = await tmdbFetch("/search/multi", apiKey, {
    query,
    year,
    include_adult: "false",
  });
  return (data.results || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map(normalizeResult);
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
