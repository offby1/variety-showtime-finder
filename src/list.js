import {
  getSavedItems,
  removeItem,
  recheckItem,
  clearNewlyAvailable,
  exportAllData,
  importAllData,
} from "./lib/storage.js";

const tbody = document.getElementById("list-body");
const emptyState = document.getElementById("empty-state");
const sortSelect = document.getElementById("sort-select");
const listMessage = document.getElementById("list-message");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");

let listMessageTimeout = null;
function showListMessage(text) {
  clearTimeout(listMessageTimeout);
  listMessage.textContent = text;
  listMessage.hidden = false;
  listMessageTimeout = setTimeout(() => {
    listMessage.hidden = true;
  }, 6000);
}

let settings = null;
let items = [];
// Items that were newly-available as of page load, so we can flag them
// even after clearNewlyAvailable() resets the flag for future badge counts.
let recentlyNewKeys = new Set();

async function loadSettings() {
  const { settings: s } = await chrome.storage.sync.get("settings");
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

function renderLiveShowtimes(container, result) {
  container.innerHTML = "";
  if (!result || result.error) {
    container.textContent = "Couldn't load live showtimes.";
    return;
  }
  if (!result.theaters?.length) {
    container.textContent = result.timedOut ? "Timed out waiting for Fandango." : "No showtimes found today.";
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

    if (t.isReleaseInFuture === false) {
      const liveResults = document.createElement("div");
      liveResults.className = "live-showtimes";

      const liveButton = document.createElement("button");
      liveButton.type = "button";
      liveButton.className = "live-showtimes-btn";
      liveButton.textContent = "Show live showtimes";
      liveButton.addEventListener("click", async () => {
        liveButton.disabled = true;
        liveButton.textContent = "Loading…";
        liveResults.innerHTML = "";
        try {
          const result = await chrome.runtime.sendMessage({
            type: "GET_LIVE_SHOWTIMES",
            slug: t.slug,
            zip: settings?.zip,
          });
          renderLiveShowtimes(liveResults, result);
        } finally {
          liveButton.textContent = "Refresh";
          liveButton.disabled = false;
        }
      });

      theatricalTd.append(document.createElement("br"), liveButton, liveResults);
    }
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
      const result = await recheckItem(item, settings.tmdbApiKey, settings.region || "US", settings.zip);
      await refreshItems();
      if (result.streamingError) {
        showListMessage(`Streaming check failed for "${item.title}": ${result.streamingError.message}`);
      } else if (result.theatricalError) {
        showListMessage(`Theatrical check failed for "${item.title}": ${result.theatricalError.message}`);
      }
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

exportBtn.addEventListener("click", async () => {
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `variety-showtime-finder-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showListMessage(`Exported ${Object.keys(data).length} entries.`);
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    await importAllData(data);
    await loadSettings();
    await refreshItems();
    showListMessage(`Imported ${Object.keys(data).length} entries.`);
  } catch (err) {
    showListMessage(`Import failed: ${err.message}`);
  }
});

async function init() {
  await loadSettings();
  items = await getSavedItems();
  recentlyNewKeys = new Set(items.filter((i) => i.newlyAvailable).map((i) => i.key));
  await clearNewlyAvailable();
  render();
}

init();
