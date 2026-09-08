import { getSavedItems, removeItem, recheckItem, clearNewlyAvailable } from "./lib/storage.js";

const tbody = document.getElementById("list-body");
const emptyState = document.getElementById("empty-state");
const sortSelect = document.getElementById("sort-select");

let settings = null;
let items = [];
// Items that were newly-available as of page load, so we can flag them
// even after clearNewlyAvailable() resets the flag for future badge counts.
let recentlyNewKeys = new Set();

async function loadSettings() {
  const { settings: s } = await chrome.storage.local.get("settings");
  settings = s || null;
}

async function refreshItems() {
  items = await getSavedItems();
  render();
}

function sortedItems() {
  const sorted = [...items];
  switch (sortSelect.value) {
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "available":
      sorted.sort((a, b) => Number(b.available) - Number(a.available));
      break;
    case "savedAt":
    default:
      sorted.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  return sorted;
}

function render() {
  const sorted = sortedItems();
  emptyState.hidden = sorted.length > 0;
  tbody.innerHTML = "";
  for (const item of sorted) {
    tbody.appendChild(renderRow(item));
  }
}

function renderRow(item) {
  const tr = document.createElement("tr");

  const posterTd = document.createElement("td");
  if (item.posterUrl) {
    const img = document.createElement("img");
    img.src = item.posterUrl;
    img.alt = "";
    posterTd.appendChild(img);
  }

  const titleTd = document.createElement("td");
  const titleDiv = document.createElement("div");
  titleDiv.className = "title-cell";
  titleDiv.textContent = item.year ? `${item.title} (${item.year})` : item.title;
  if (recentlyNewKeys.has(item.key)) {
    const badge = document.createElement("span");
    badge.className = "new-badge";
    badge.textContent = "New";
    titleDiv.appendChild(badge);
  }
  titleTd.appendChild(titleDiv);

  const typeDiv = document.createElement("div");
  typeDiv.className = "type-cell";
  typeDiv.textContent = item.mediaType === "movie" ? "Movie" : "TV";
  titleTd.appendChild(typeDiv);

  if (item.sourceUrl) {
    const a = document.createElement("a");
    a.href = item.sourceUrl;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Variety review";
    a.className = "source-link";
    titleTd.appendChild(a);
  }

  const streamingTd = document.createElement("td");
  streamingTd.textContent = item.streaming?.flatrate?.length
    ? item.streaming.flatrate.map((p) => p.provider_name).join(", ")
    : "Not yet streaming";

  const theatricalTd = document.createElement("td");
  if (item.mediaType !== "movie") {
    theatricalTd.textContent = "—";
  } else if (item.theatrical?.found) {
    const t = item.theatrical;
    const statusText =
      t.isReleaseInFuture === true
        ? t.releaseDate
          ? `Opens ${t.releaseDate}`
          : "Not yet released"
        : t.isReleaseInFuture === false
          ? t.releaseDate
            ? `Released ${t.releaseDate}`
            : "Released"
          : "Unknown";
    theatricalTd.appendChild(document.createTextNode(statusText + " "));
    const a = document.createElement("a");
    a.href = t.showtimesUrl;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "source-link";
    a.textContent = "Showtimes on Fandango";
    theatricalTd.appendChild(a);
  } else {
    theatricalTd.textContent = "No Fandango match / not checked yet";
  }

  const savedTd = document.createElement("td");
  savedTd.textContent = new Date(item.savedAt).toLocaleDateString();

  const checkedTd = document.createElement("td");
  checkedTd.textContent = item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString() : "Never";

  const actionsTd = document.createElement("td");
  actionsTd.className = "actions-cell";

  const recheckButton = document.createElement("button");
  recheckButton.type = "button";
  recheckButton.textContent = "Recheck";
  recheckButton.addEventListener("click", async () => {
    if (!settings?.tmdbApiKey) {
      alert("Set your TMDB API key in Settings first.");
      return;
    }
    recheckButton.disabled = true;
    recheckButton.textContent = "...";
    try {
      await recheckItem(item, settings.tmdbApiKey, settings.region || "US", settings.zip);
      await refreshItems();
    } finally {
      recheckButton.disabled = false;
      recheckButton.textContent = "Recheck";
    }
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", async () => {
    await removeItem(item.key);
    await refreshItems();
  });

  actionsTd.append(recheckButton, removeButton);
  tr.append(posterTd, titleTd, streamingTd, theatricalTd, savedTd, checkedTd, actionsTd);
  return tr;
}

sortSelect.addEventListener("change", render);

async function init() {
  await loadSettings();
  items = await getSavedItems();
  recentlyNewKeys = new Set(items.filter((i) => i.newlyAvailable).map((i) => i.key));
  await clearNewlyAvailable();
  render();
}

init();
