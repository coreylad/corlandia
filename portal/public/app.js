const appsEl = document.querySelector("#apps");
const searchEl = document.querySelector("#search");
const categoriesEl = document.querySelector("#categories");
const statusFilterEl = document.querySelector("#statusFilter");
const noticeEl = document.querySelector("#notice");
const toastEl = document.querySelector("#toast");
const installCommandEl = document.querySelector("#installCommand");
const copyInstallEl = document.querySelector("#copyInstall");
const refreshCatalogEl = document.querySelector("#refreshCatalog");
const availableCountEl = document.querySelector("#availableCount");
const installedCountEl = document.querySelector("#installedCount");
const containerCountEl = document.querySelector("#containerCount");
const catalogStateEl = document.querySelector("#catalogState");
const versionStatusEl = document.querySelector("#versionStatus");
const checkUpdatesEl = document.querySelector("#checkUpdates");
const updateSystemEl = document.querySelector("#updateSystem");
const updateLogWrapEl = document.querySelector("#updateLogWrap");
const updateLogEl = document.querySelector("#updateLog");
const hideUpdateLogEl = document.querySelector("#hideUpdateLog");

let apps = [];
let system = null;
let selectedCategory = "all";
let busyAppId = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

function showNotice(message, tone = "info") {
  noticeEl.textContent = message;
  noticeEl.dataset.tone = tone;
  noticeEl.hidden = false;
}

function clearNotice() {
  noticeEl.hidden = true;
}

function localUrl(app) {
  const host = window.location.hostname || "SERVER_IP";
  if (app.url) {
    return app.url
      .replaceAll("{host}", host)
      .replaceAll("{port}", app.port || "");
  }
  if (!app.port) return "";
  return `http://${host}:${encodeURIComponent(app.port)}${app.path || ""}`;
}

function appInitials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  showToast("Install command copied");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function loadApps({ refresh = false } = {}) {
  catalogStateEl.textContent = "Loading";
  const payload = await fetchJson(`/api/apps${refresh ? "?refresh=1" : ""}`);
  apps = payload.apps || [];
  catalogStateEl.textContent = payload.cached ? "Cached" : "Live";
  renderCategories();
  renderApps();
}

async function loadSystem({ refresh = false } = {}) {
  system = await fetchJson(`/api/system${refresh ? "?refresh=1" : ""}`);
  renderSystem();
}

async function changeInstallState(appId, action) {
  busyAppId = appId;
  clearNotice();
  renderApps();
  const payload = await fetchJson(`/api/apps/${encodeURIComponent(appId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  apps = payload.apps || [];
  busyAppId = null;
  showToast(action === "install" ? "Install started" : "App removed");
  renderCategories();
  renderApps();
  await loadSystem();
}

function renderSystem() {
  const containers = system?.containers || [];
  containerCountEl.textContent = String(containers.length);

  if (!system) {
    versionStatusEl.textContent = "Version unknown";
    updateSystemEl.disabled = true;
    return;
  }

  const local = system.localCommit || "unknown";
  const remote = system.remoteCommit || "unknown";
  if (system.updateAvailable) {
    versionStatusEl.innerHTML = `Update available<br><small>${escapeHTML(local)} → ${escapeHTML(remote)}</small>`;
    updateSystemEl.disabled = false;
  } else {
    versionStatusEl.innerHTML = `Up to date<br><small>${escapeHTML(local)}</small>`;
    updateSystemEl.disabled = true;
  }

  if (system.updateLog) {
    updateLogEl.textContent = system.updateLog;
    updateLogWrapEl.hidden = false;
  }
}

function renderCategories() {
  const categories = ["all", ...new Set(apps.map((app) => app.category).filter(Boolean).sort())];
  categoriesEl.innerHTML = categories.map((category) => `
    <button class="chip ${category === selectedCategory ? "active" : ""}" data-category="${escapeHTML(category)}">
      ${escapeHTML(category === "all" ? "All" : category)}
    </button>
  `).join("");

  categoriesEl.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCategory = button.dataset.category;
      renderCategories();
      renderApps();
    });
  });
}

function filteredApps() {
  const term = searchEl.value.trim().toLowerCase();
  const status = statusFilterEl.value;
  return apps
    .filter((app) => {
      const haystack = [app.name, app.category, app.tagline, app.description, app.image].join(" ").toLowerCase();
      const matchesTerm = !term || haystack.includes(term);
      const matchesCategory = selectedCategory === "all" || app.category === selectedCategory;
      const matchesStatus = status === "all" || (status === "installed" ? app.installed : !app.installed);
      return matchesTerm && matchesCategory && matchesStatus;
    })
    .sort((a, b) => Number(b.installed) - Number(a.installed) || Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
}

function renderApps() {
  const installedCount = apps.filter((app) => app.installed).length;
  availableCountEl.textContent = String(apps.length);
  installedCountEl.textContent = String(installedCount);

  const visibleApps = filteredApps();
  if (visibleApps.length === 0) {
    appsEl.innerHTML = `<div class="empty">No apps match that filter.</div>`;
    return;
  }

  appsEl.innerHTML = visibleApps.map((app) => {
    const openUrl = localUrl(app);
    const action = app.installed ? "uninstall" : "install";
    const actionLabel = busyAppId === app.id ? "Working" : app.installed ? "Uninstall" : "Install";
    const secondaryLinks = [
      app.website ? `<a href="${escapeHTML(app.website)}" target="_blank" rel="noreferrer">Website</a>` : "",
      app.docs ? `<a href="${escapeHTML(app.docs)}" target="_blank" rel="noreferrer">Docs</a>` : "",
      app.repository ? `<a href="${escapeHTML(app.repository)}" target="_blank" rel="noreferrer">Source</a>` : "",
    ].filter(Boolean).join("");

    return `
      <article class="app-card ${app.installed ? "installed" : ""}">
        <div class="app-card-head">
          <span class="app-icon">${escapeHTML(appInitials(app.name))}</span>
          <div>
            <h3>${escapeHTML(app.name)}</h3>
            <span>${escapeHTML(app.category)} · ${escapeHTML(app.weight)}</span>
          </div>
        </div>
        <p>${escapeHTML(app.description || app.tagline)}</p>
        <div class="image-tag">${escapeHTML(app.image || "No image listed")}</div>
        <div class="app-links">${secondaryLinks}</div>
        <div class="app-actions">
          <button class="button primary" data-action="${action}" data-app="${escapeHTML(app.id)}" ${busyAppId === app.id ? "disabled" : ""}>${actionLabel}</button>
          ${openUrl ? `<a class="button" href="${escapeHTML(openUrl)}" target="_blank" rel="noreferrer">Open</a>` : `<button class="button" disabled>No UI</button>`}
        </div>
      </article>
    `;
  }).join("");

  appsEl.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await changeInstallState(button.dataset.app, button.dataset.action);
      } catch (error) {
        busyAppId = null;
        showNotice(error.message, "error");
        renderApps();
      }
    });
  });
}

async function boot() {
  try {
    await Promise.all([loadApps(), loadSystem()]);
  } catch (error) {
    showNotice(error.message, "error");
    appsEl.innerHTML = `<div class="empty">Could not load the dashboard.</div>`;
  }
}

searchEl.addEventListener("input", renderApps);
statusFilterEl.addEventListener("change", renderApps);
copyInstallEl.addEventListener("click", () => copyText(installCommandEl.textContent));
refreshCatalogEl.addEventListener("click", async () => {
  try {
    await loadApps({ refresh: true });
    showToast("App store refreshed from GitHub XML");
  } catch (error) {
    showNotice(error.message, "error");
  }
});
checkUpdatesEl.addEventListener("click", async () => {
  try {
    versionStatusEl.textContent = "Checking...";
    await loadSystem({ refresh: true });
    showToast("Update check complete");
  } catch (error) {
    versionStatusEl.textContent = "Update check failed";
    showNotice(error.message, "error");
  }
});
updateSystemEl.addEventListener("click", async () => {
  try {
    updateSystemEl.disabled = true;
    updateSystemEl.textContent = "Updating...";
    const payload = await fetchJson("/api/system/update", { method: "POST" });
    showToast(payload.message || "Update started");
    setTimeout(() => loadSystem({ refresh: true }).catch(() => {}), 5000);
  } catch (error) {
    updateSystemEl.disabled = false;
    updateSystemEl.textContent = "Update Dashboard";
    showNotice(error.message, "error");
  }
});
hideUpdateLogEl.addEventListener("click", () => {
  updateLogWrapEl.hidden = true;
});

boot();
