import { searchTitles, getWatchProviders, providerLogoUrl } from "./lib/tmdb.js";

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const resultsList = document.getElementById("search-results");
const searchSection = document.getElementById("search-section");
const detailSection = document.getElementById("detail-section");
const detailContent = document.getElementById("detail-content");
const backButton = document.getElementById("back-button");

let settings = null;

async function loadSettings() {
  const { settings: s } = await chrome.storage.local.get("settings");
  settings = s || null;
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
    const providers = await getWatchProviders(
      settings.tmdbApiKey,
      result.mediaType,
      result.id,
      settings.region || "US"
    );
    renderDetail(result, providers);
  } catch (err) {
    detailContent.textContent = `Error: ${err.message}`;
  }
}

function renderDetail(result, providers) {
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
}

backButton.addEventListener("click", () => {
  detailSection.hidden = true;
  searchSection.hidden = false;
});

loadSettings();
