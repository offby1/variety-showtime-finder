const form = document.getElementById("settings-form");
const apiKeyInput = document.getElementById("tmdb-api-key");
const regionInput = document.getElementById("region");
const zipInput = document.getElementById("zip");
const status = document.getElementById("save-status");

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  apiKeyInput.value = settings?.tmdbApiKey || "";
  regionInput.value = settings?.region || "US";
  zipInput.value = settings?.zip || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const settings = {
    tmdbApiKey: apiKeyInput.value.trim(),
    region: (regionInput.value.trim() || "US").toUpperCase(),
    zip: zipInput.value.trim(),
  };
  await chrome.storage.sync.set({ settings });
  status.textContent = "Saved.";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});

loadSettings();
