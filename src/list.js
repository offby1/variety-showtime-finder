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

// Builds a standalone HTML snapshot of the current (sorted) list - no
// chrome.* APIs available once this is saved as a standalone file, so no
// Recheck/Remove/live-showtimes buttons, just what's already known. Meant to
// be manually re-exported and uploaded to a web host (e.g. GitHub Pages) to
// check the list from a device that can't run this extension, like an
// iPhone. The layout is phone-first: one tall card per title with a large
// poster, and a small inline script provides a search box that filters the
// cards by their text. The posters are linked from TMDB, not embedded, so
// the page must be viewed in a browser that is allowed to load them; file
// previewers such as the iOS Files app block remote images.
function buildHtmlExport() {
  const sorted = sortedItems();
  const cards = sorted
    .map((item) => {
      // The stored poster is TMDB's small w200 rendering; TMDB serves any
      // size from the same path, so ask for a larger one to stay sharp when
      // the poster fills the screen.
      const posterSrc = item.posterUrl ? item.posterUrl.replace("/t/p/w200/", "/t/p/w500/") : null;
      const poster = posterSrc
        ? `<img class="poster" src="${escapeHtml(posterSrc)}" alt="" />`
        : `<div class="poster poster-missing">No poster</div>`;
      const titleLine = escapeHtml(item.year ? `${item.title} (${item.year})` : item.title);
      const typeLabel = item.mediaType === "movie" ? "Movie" : "TV";
      const sourceLink = item.sourceUrl
        ? `<a class="btn" href="${escapeHtml(item.sourceUrl)}">Variety review</a>`
        : "";

      let theatricalText = null;
      let showtimesLink = "";
      if (item.mediaType === "movie") {
        if (item.theatrical?.found) {
          theatricalText = theatricalStatusText(item);
          if (item.theatrical.showtimesUrl) {
            showtimesLink = `<a class="btn" href="${escapeHtml(item.theatrical.showtimesUrl)}">Showtimes on Fandango</a>`;
          }
        } else {
          theatricalText = "No Fandango match / not checked yet";
        }
      }

      const streaming = streamingText(item);
      const saved = formatTimestamp(new Date(item.savedAt));
      const checked = item.lastCheckedAt ? formatTimestamp(new Date(item.lastCheckedAt)) : "Never";
      const searchText = [
        item.title,
        item.year,
        typeLabel,
        streaming,
        theatricalText,
        saved,
        checked,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return `
  <article class="card" data-search="${escapeHtml(searchText)}">
    ${poster}
    <div class="info">
      <h2>${titleLine}</h2>
      <div class="type">${typeLabel}</div>
      <dl>
        <dt>Streaming</dt><dd>${escapeHtml(streaming)}</dd>${
          theatricalText
            ? `\n        <dt>Theatrical</dt><dd>${escapeHtml(theatricalText)}</dd>`
            : ""
        }
        <dt>Saved</dt><dd>${escapeHtml(saved)}</dd>
        <dt>Last checked</dt><dd>${escapeHtml(checked)}</dd>
      </dl>
      <div class="links">${showtimesLink}${sourceLink}</div>
    </div>
  </article>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Showtime Finder — Saved List</title>
<style>
:root { color-scheme: light dark; --bg: #f4f4f6; --card: #fff; --text: #1a1a1a; --muted: #666; --link: #2a5adf; --line: #e2e2e6; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #111; --card: #1e1e22; --text: #f0f0f0; --muted: #a0a0a8; --link: #7ba3ff; --line: #333; }
}
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; margin: 0; background: var(--bg); color: var(--text); }
header { position: sticky; top: 0; z-index: 10; background: var(--bg); padding: 0.75rem 1rem; border-bottom: 1px solid var(--line); }
h1 { font-size: 1.1rem; margin: 0; }
.generated-at { color: var(--muted); font-size: 0.75rem; margin: 0.15rem 0 0.5rem; }
#search { width: 100%; font-size: 1rem; padding: 0.6rem 0.75rem; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); }
#count { color: var(--muted); font-size: 0.75rem; margin-top: 0.35rem; }
main { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.card { background: var(--card); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; min-height: calc(100svh - 9rem); }
.card[hidden] { display: none; }
.poster { width: 100%; height: 55svh; object-fit: contain; background: #000; display: block; }
.poster-missing { display: flex; align-items: center; justify-content: center; color: #888; }
.info { padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; flex: 1; }
h2 { font-size: 1.3rem; margin: 0; }
.type { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 0.75rem; font-size: 1rem; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.links { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: auto; padding-top: 0.5rem; }
.btn { color: var(--link); border: 1px solid var(--link); border-radius: 8px; padding: 0.55rem 0.9rem; text-decoration: none; font-size: 0.95rem; }
#none { text-align: center; color: var(--muted); padding: 2rem; }
</style>
</head>
<body>
<header>
  <h1>Saved Titles</h1>
  <p class="generated-at">Generated ${escapeHtml(formatTimestamp(new Date()))}</p>
  <input id="search" type="search" placeholder="Search titles, streaming services, status…" autocomplete="off" />
  <div id="count"></div>
</header>
<main>${cards}
  <p id="none" hidden>No titles match your search.</p>
</main>
<script>
(function () {
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  var search = document.getElementById("search");
  var count = document.getElementById("count");
  var none = document.getElementById("none");
  function apply() {
    var terms = search.value.toLowerCase().split(/\\s+/).filter(Boolean);
    var shown = 0;
    cards.forEach(function (card) {
      var text = card.getAttribute("data-search");
      var match = terms.every(function (t) { return text.indexOf(t) !== -1; });
      card.hidden = !match;
      if (match) shown++;
    });
    none.hidden = shown !== 0;
    count.textContent = shown === cards.length ? cards.length + " titles" : shown + " of " + cards.length + " titles";
  }
  search.addEventListener("input", apply);
  apply();
})();
</script>
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
