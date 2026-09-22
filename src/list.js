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
const exportHtmlBtn = document.getElementById("export-html-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");

// ISO 8601 with a numeric timezone offset (e.g. 2026-09-22T08:20:26-07:00),
// for human-facing timestamps - unambiguous across locales/devices, unlike
// toLocaleString()/toLocaleDateString().
function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
}

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

function streamingText(item) {
  return item.streaming?.flatrate?.length
    ? item.streaming.flatrate.map((p) => p.provider_name).join(", ")
    : "Not yet streaming";
}

function theatricalStatusText(item) {
  if (item.mediaType !== "movie") return null;
  if (!item.theatrical?.found) return null;
  const t = item.theatrical;
  return t.isReleaseInFuture === true
    ? t.releaseDate
      ? `Opens ${t.releaseDate}`
      : "Not yet released"
    : t.isReleaseInFuture === false
      ? t.releaseDate
        ? `Released ${t.releaseDate}`
        : "Released"
      : "Unknown";
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
  streamingTd.textContent = streamingText(item);

  const theatricalTd = document.createElement("td");
  if (item.mediaType !== "movie") {
    theatricalTd.textContent = "—";
  } else if (item.theatrical?.found) {
    const t = item.theatrical;
    const statusText = theatricalStatusText(item);
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
  savedTd.textContent = formatTimestamp(new Date(item.savedAt));

  const checkedTd = document.createElement("td");
  checkedTd.textContent = item.lastCheckedAt ? formatTimestamp(new Date(item.lastCheckedAt)) : "Never";

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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// Builds a static, script-free HTML snapshot of the current (sorted) list -
// no chrome.* APIs available once this is saved as a standalone file, so no
// Recheck/Remove/live-showtimes buttons, just what's already known. Meant to
// be manually re-exported and uploaded/shared somewhere (e.g. Google Drive)
// to check the list from a device that can't run this extension, like an
// iPhone.
function buildHtmlExport() {
  const sorted = sortedItems();
  const rows = sorted
    .map((item) => {
      const poster = item.posterUrl
        ? `<img src="${escapeHtml(item.posterUrl)}" alt="" />`
        : "";
      const titleLine = escapeHtml(item.year ? `${item.title} (${item.year})` : item.title);
      const typeLabel = item.mediaType === "movie" ? "Movie" : "TV";
      const sourceLink = item.sourceUrl
        ? `<a href="${escapeHtml(item.sourceUrl)}">Variety review</a>`
        : "";

      let theatricalHtml = "—";
      if (item.mediaType === "movie") {
        if (item.theatrical?.found) {
          const statusText = escapeHtml(theatricalStatusText(item));
          const showtimesLink = item.theatrical.showtimesUrl
            ? ` <a href="${escapeHtml(item.theatrical.showtimesUrl)}">Showtimes on Fandango</a>`
            : "";
          theatricalHtml = statusText + showtimesLink;
        } else {
          theatricalHtml = "No Fandango match / not checked yet";
        }
      }

      return `
    <tr>
      <td>${poster}</td>
      <td>
        <div class="title-cell">${titleLine}</div>
        <div class="type-cell">${typeLabel}</div>
        ${sourceLink}
      </td>
      <td>${escapeHtml(streamingText(item))}</td>
      <td>${theatricalHtml}</td>
      <td>${escapeHtml(formatTimestamp(new Date(item.savedAt)))}</td>
      <td>${item.lastCheckedAt ? escapeHtml(formatTimestamp(new Date(item.lastCheckedAt))) : "Never"}</td>
    </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Showtime Finder — Saved List</title>
<style>
body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #1a1a1a; }
h1 { font-size: 1.3rem; }
.generated-at { color: #666; font-size: 0.85rem; margin-top: -0.5rem; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; vertical-align: top; font-size: 0.9rem; }
th { font-size: 0.8rem; color: #666; text-transform: uppercase; letter-spacing: 0.02em; }
td img { width: 46px; height: 68px; object-fit: cover; border-radius: 3px; background: #ddd; }
.title-cell { font-weight: 600; }
.type-cell { font-size: 0.75rem; color: #666; }
a { color: #2a5adf; }
</style>
</head>
<body>
<h1>Saved Titles</h1>
<p class="generated-at">Generated ${escapeHtml(formatTimestamp(new Date()))}</p>
<table>
  <thead>
    <tr>
      <th></th>
      <th>Title</th>
      <th>Streaming</th>
      <th>Theatrical</th>
      <th>Saved</th>
      <th>Last checked</th>
    </tr>
  </thead>
  <tbody>${rows}
  </tbody>
</table>
</body>
</html>
`;
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

exportHtmlBtn.addEventListener("click", () => {
  const html = buildHtmlExport();
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `variety-showtime-finder-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showListMessage(`Exported ${items.length} entries as HTML.`);
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
