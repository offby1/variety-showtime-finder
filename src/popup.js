import { searchTitles, getWatchProviders, providerLogoUrl } from "./lib/tmdb.js";
import { getTheatricalStatus } from "./lib/fandango.js";
import { saveItem, isSaved, getSavedItems, removeItem, recheckItem } from "./lib/storage.js";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const resultsList = document.getElementById("search-results");
const searchSection = document.getElementById("search-section");
const detailSection = document.getElementById("detail-section");
const detailContent = document.getElementById("detail-content");
const backButton = document.getElementById("back-button");
const reviewBanner = document.getElementById("review-banner");
const reviewTitle = document.getElementById("review-title");
const savedList = document.getElementById("saved-list");
const savedMessage = document.getElementById("saved-message");

let savedMessageTimeout = null;
function showSavedMessage(text) {
  clearTimeout(savedMessageTimeout);
  savedMessage.textContent = text;
  savedMessage.hidden = false;
  savedMessageTimeout = setTimeout(() => {
    savedMessage.hidden = true;
  }, 6000);
}

let settings = null;
let currentReviewUrl = null;

async function loadSettings() {
  const { settings: s } = await chrome.storage.local.get("settings");
  settings = s || null;
}

// Normally, "what review is this?" is answered by asking the background
// worker about the active tab - that works when popup.html is a real
// toolbar popup, since the tab behind it is what's active. But the banner
// on a Variety review page (src/content/variety.js) opens this same
// popup.html as a plain tab instead (content scripts can't open the real
// toolbar popup) - and then THIS tab is the active one, so that lookup
// would find nothing. The banner passes the source tab's id (and, as a
// fallback that doesn't depend on that lookup succeeding, the title
// itself) via the URL for that case.
async function loadDetectedReview() {
  const params = new URLSearchParams(location.search);
  const sourceTabId = params.get("sourceTabId");
  const fallbackTitle = params.get("title");

  if (sourceTabId) {
    const detected = await chrome.runtime.sendMessage({
      type: "GET_DETECTED_REVIEW",
      tabId: Number(sourceTabId),
    });
    if (detected) return detected;
  }
  if (fallbackTitle) {
    return { title: fallbackTitle, mediaType: null, url: null };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  return chrome.runtime.sendMessage({ type: "GET_DETECTED_REVIEW", tabId: tab.id });
}

function requireSettings() {
  if (!settings || !settings.tmdbApiKey) {
    searchStatus.textContent = "Set your TMDB API key in Settings first.";
    return false;
  }
  return true;
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireSettings()) return;
  const query = searchInput.value.trim();
  if (!query) return;
  await runSearch(query);
});

async function runSearch(query) {
  resultsList.innerHTML = "";
  searchStatus.textContent = "Searching...";
  try {
    const results = await searchTitles(settings.tmdbApiKey, query);
    searchStatus.textContent = results.length ? "" : "No results.";
    for (const result of results) {
      resultsList.appendChild(renderResultItem(result));
    }
  } catch (err) {
    searchStatus.textContent = `Error: ${err.message}`;
  }
}

function renderResultItem(result) {
  const li = document.createElement("li");
  li.className = "result-item";

  const img = document.createElement("img");
  if (result.posterUrl) {
    img.src = result.posterUrl;
    img.alt = "";
  } else {
    img.classList.add("poster-placeholder");
  }

  const info = document.createElement("div");
  info.className = "result-info";
  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = result.year ? `${result.title} (${result.year})` : result.title;
  const type = document.createElement("div");
  type.className = "result-type";
  type.textContent = result.mediaType === "movie" ? "Movie" : "TV";
  info.append(title, type);

  li.append(img, info);
  li.addEventListener("click", () => showDetail(result));
  return li;
}

async function showDetail(result) {
  searchSection.hidden = true;
  detailSection.hidden = false;
  detailContent.textContent = "Loading...";
  try {
    const providersPromise = getWatchProviders(
      settings.tmdbApiKey,
      result.mediaType,
      result.id,
      settings.region || "US"
    );
    // Fandango only covers movies; theatrical is null for TV.
    const theatricalPromise =
      result.mediaType === "movie"
        ? getTheatricalStatus(result.title, result.year, settings.zip).catch(() => ({
            found: false,
            error: true,
          }))
        : Promise.resolve(null);

    const [providers, theatrical] = await Promise.all([providersPromise, theatricalPromise]);
    await renderDetail(result, providers, theatrical);
  } catch (err) {
    detailContent.textContent = `Error: ${err.message}`;
  }
}

function renderTheatrical(theatrical) {
  const section = document.createElement("div");
  section.className = "theatrical";

  if (!theatrical || !theatrical.found) {
    const p = document.createElement("p");
    p.textContent = theatrical?.error
      ? "Couldn't reach Fandango to check theatrical status."
      : "No Fandango listing found for this title.";
    section.appendChild(p);
    return section;
  }

  const status = document.createElement("p");
  if (theatrical.isReleaseInFuture === true) {
    status.textContent = theatrical.releaseDate
      ? `Opens in theaters ${theatrical.releaseDate}`
      : "Not yet in theaters";
  } else if (theatrical.isReleaseInFuture === false) {
    status.textContent = theatrical.releaseDate
      ? `Released in theaters ${theatrical.releaseDate}`
      : "Currently/previously in theaters";
  } else {
    status.textContent = "Theatrical status unknown";
  }
  section.appendChild(status);

  const linksP = document.createElement("p");
  const showtimesLink = document.createElement("a");
  showtimesLink.href = theatrical.showtimesUrl;
  showtimesLink.target = "_blank";
  showtimesLink.rel = "noopener";
  showtimesLink.textContent = "Find showtimes on Fandango →";
  linksP.appendChild(showtimesLink);
  section.appendChild(linksP);

  if (theatrical.isReleaseInFuture === false) {
    const resultsDiv = document.createElement("div");
    resultsDiv.className = "live-showtimes";

    const liveButton = document.createElement("button");
    liveButton.type = "button";
    liveButton.textContent = "Show live showtimes here";
    liveButton.addEventListener("click", async () => {
      liveButton.disabled = true;
      liveButton.textContent = "Loading… (opens a background tab briefly)";
      resultsDiv.innerHTML = "";
      try {
        const result = await chrome.runtime.sendMessage({
          type: "GET_LIVE_SHOWTIMES",
          slug: theatrical.slug,
          zip: settings?.zip,
        });
        renderLiveShowtimes(resultsDiv, result);
      } catch (err) {
        resultsDiv.textContent = `Error: ${err.message}`;
      } finally {
        liveButton.textContent = "Refresh live showtimes";
        liveButton.disabled = false;
      }
    });

    section.append(liveButton, resultsDiv);
  }

  return section;
}

function renderLiveShowtimes(container, result) {
  container.innerHTML = "";
  if (!result || result.error) {
    container.textContent = "Couldn't load live showtimes. Try the Fandango link above instead.";
    return;
  }
  if (!result.theaters?.length) {
    container.textContent = result.timedOut
      ? "Timed out waiting for Fandango. Try the link above instead."
      : "No showtimes found today near your zip code.";
    return;
  }

  for (const theater of result.theaters) {
    const theaterDiv = document.createElement("div");
    theaterDiv.className = "live-theater";

    const name = document.createElement("div");
    name.className = "live-theater-name";
    name.textContent = theater.distance ? `${theater.name} (${theater.distance})` : theater.name;
    theaterDiv.appendChild(name);

    for (const fmt of theater.formats) {
      const fmtDiv = document.createElement("div");
      fmtDiv.className = "live-theater-format";

      const label = document.createElement("span");
      label.className = "live-format-label";
      label.textContent = `${fmt.format}: `;
      fmtDiv.appendChild(label);

      for (const t of fmt.times) {
        const a = document.createElement("a");
        a.href = t.url || theater.url || "#";
        a.target = "_blank";
        a.rel = "noopener";
        a.className = "live-time";
        a.textContent = t.time;
        fmtDiv.appendChild(a);
      }
      theaterDiv.appendChild(fmtDiv);
    }
    container.appendChild(theaterDiv);
  }
}

async function renderDetail(result, providers, theatrical) {
  detailContent.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = result.year ? `${result.title} (${result.year})` : result.title;
  const typeLabel = document.createElement("p");
  typeLabel.className = "result-type";
  typeLabel.textContent = result.mediaType === "movie" ? "Movie" : "TV Show";
  detailContent.append(heading, typeLabel);

  if (providers.flatrate.length) {
    const list = document.createElement("ul");
    list.className = "providers";
    for (const p of providers.flatrate) {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = providerLogoUrl(p.logo_path);
      img.alt = p.provider_name;
      img.title = p.provider_name;
      li.appendChild(img);
      list.appendChild(li);
    }
    detailContent.appendChild(list);
  } else {
    const p = document.createElement("p");
    p.textContent = `Not currently streaming in ${providers.region}.`;
    detailContent.appendChild(p);
  }

  if (providers.link) {
    const p = document.createElement("p");
    const a = document.createElement("a");
    a.href = providers.link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "See all options on TMDB →";
    p.appendChild(a);
    detailContent.appendChild(p);
  }

  if (result.mediaType === "movie") {
    detailContent.appendChild(renderTheatrical(theatrical));
  }

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  const alreadySaved = await isSaved(result.mediaType, result.id);
  saveButton.textContent = alreadySaved ? "Saved" : "Save for later";
  saveButton.disabled = alreadySaved;
  saveButton.addEventListener("click", async () => {
    await saveItem({
      mediaType: result.mediaType,
      tmdbId: result.id,
      title: result.title,
      year: result.year,
      posterUrl: result.posterUrl,
      sourceUrl: currentReviewUrl,
      streaming: providers,
      theatrical,
    });
    saveButton.textContent = "Saved";
    saveButton.disabled = true;
    await renderSavedList();
  });
  detailContent.appendChild(saveButton);
}

async function renderSavedList() {
  const items = await getSavedItems();
  savedList.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "saved-empty";
    li.textContent = "Nothing saved yet.";
    savedList.appendChild(li);
    return;
  }

  for (const item of [...items].sort((a, b) => b.savedAt.localeCompare(a.savedAt))) {
    savedList.appendChild(renderSavedItem(item));
  }
}

function savedItemStatusText(item) {
  const streamingProviders = item.streaming?.flatrate?.map((p) => p.provider_name).join(", ");
  const inTheaters = item.mediaType === "movie" && item.theatrical?.found && item.theatrical.isReleaseInFuture === false;

  if (streamingProviders && inTheaters) return `Streaming (${streamingProviders}) & in theaters`;
  if (streamingProviders) return `Streaming: ${streamingProviders}`;
  if (inTheaters) return "In theaters";
  if (item.mediaType === "movie" && item.theatrical?.isReleaseInFuture) {
    return item.theatrical.releaseDate ? `Opens ${item.theatrical.releaseDate}` : "Not yet released";
  }
  return "Not yet available";
}

function renderSavedItem(item) {
  const li = document.createElement("li");
  li.className = "saved-item";

  const info = document.createElement("div");
  info.className = "saved-info";
  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = item.year ? `${item.title} (${item.year})` : item.title;
  const status = document.createElement("div");
  status.className = "saved-status";
  status.textContent = savedItemStatusText(item);
  info.append(title, status);

  const actions = document.createElement("div");
  actions.className = "saved-actions";

  const recheckButton = document.createElement("button");
  recheckButton.type = "button";
  recheckButton.textContent = "Recheck";
  recheckButton.addEventListener("click", async () => {
    if (!requireSettings()) return;
    recheckButton.disabled = true;
    recheckButton.textContent = "...";
    const result = await recheckItem(item, settings.tmdbApiKey, settings.region || "US", settings.zip);
    await renderSavedList();
    if (result.streamingError) {
      showSavedMessage(`Streaming check failed for "${item.title}": ${result.streamingError.message}`);
    } else if (result.theatricalError) {
      showSavedMessage(`Theatrical check failed for "${item.title}": ${result.theatricalError.message}`);
    }
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", async () => {
    await removeItem(item.key);
    await renderSavedList();
  });

  actions.append(recheckButton, removeButton);
  li.append(info, actions);
  return li;
}

backButton.addEventListener("click", () => {
  detailSection.hidden = true;
  searchSection.hidden = false;
});

async function init() {
  await loadSettings();
  await renderSavedList();

  const detected = await loadDetectedReview();
  if (detected) {
    currentReviewUrl = detected.url;
    reviewBanner.hidden = false;
    reviewTitle.textContent = detected.title;
    searchInput.value = detected.title;
    if (requireSettings()) {
      await runSearch(detected.title);
    }
  }
}

init();
