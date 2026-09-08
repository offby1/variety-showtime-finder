import { searchTitles, getWatchProviders, providerLogoUrl } from "./lib/tmdb.js";
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

let settings = null;
let currentReviewUrl = null;

async function loadSettings() {
  const { settings: s } = await chrome.storage.local.get("settings");
  settings = s || null;
}

async function loadDetectedReview() {
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
    const providers = await getWatchProviders(
      settings.tmdbApiKey,
      result.mediaType,
      result.id,
      settings.region || "US"
    );
    await renderDetail(result, providers);
  } catch (err) {
    detailContent.textContent = `Error: ${err.message}`;
  }
}

async function renderDetail(result, providers) {
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
  status.textContent = item.available
    ? `Streaming${item.streaming?.flatrate?.length ? ": " + item.streaming.flatrate.map((p) => p.provider_name).join(", ") : ""}`
    : "Not yet available";
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
    try {
      await recheckItem(item, settings.tmdbApiKey, settings.region || "US");
    } finally {
      await renderSavedList();
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
