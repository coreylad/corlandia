const appsEl = document.querySelector("#apps");
const searchEl = document.querySelector("#search");
const categoryEl = document.querySelector("#category");
const installCommandEl = document.querySelector("#installCommand");
const copyInstallEl = document.querySelector("#copyInstall");

let apps = [];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function localUrl(app) {
  const host = window.location.hostname || "SERVER_IP";
  const port = encodeURIComponent(app.port);
  const path = app.path || "";
  return `http://${host}:${port}${path}`;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function renderApps() {
  const term = searchEl.value.trim().toLowerCase();
  const category = categoryEl.value;
  const filtered = apps.filter((app) => {
    const matchesTerm = [app.name, app.category, app.tagline].join(" ").toLowerCase().includes(term);
    const matchesCategory = category === "all" || app.category === category;
    return matchesTerm && matchesCategory;
  });

  appsEl.innerHTML = filtered.map((app) => `
    <article class="app-card">
      <div class="app-meta">
        <span>${escapeHTML(app.category)}</span>
        <span>${escapeHTML(app.installed ? "Installed" : app.weight)}</span>
      </div>
      <h3>${escapeHTML(app.name)}</h3>
      <p>${escapeHTML(app.tagline)}</p>
      <code>${escapeHTML(app.command)}</code>
      <div class="app-actions">
        <button class="button primary" data-copy="${escapeHTML(app.command)}">Copy</button>
        <a class="button" href="${localUrl(app)}">Open</a>
      </div>
    </article>
  `).join("");

  appsEl.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await copyText(button.dataset.copy);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    });
  });
}

async function boot() {
  const response = await fetch("/api/apps");
  if (!response.ok) {
    throw new Error(`Dashboard API returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  apps = payload.apps;
  const categories = [...new Set(apps.map((app) => app.category))].sort();
  categoryEl.insertAdjacentHTML("beforeend", categories.map((category) => (
    `<option value="${category}">${category}</option>`
  )).join(""));
  renderApps();
}

searchEl.addEventListener("input", renderApps);
categoryEl.addEventListener("change", renderApps);
copyInstallEl.addEventListener("click", async () => {
  await copyText(installCommandEl.textContent);
  copyInstallEl.textContent = "Copied";
  setTimeout(() => {
    copyInstallEl.textContent = "Copy Install Command";
  }, 1200);
});

boot().catch((error) => {
  appsEl.innerHTML = `<p>Could not load app catalog: ${error.message}</p>`;
});
