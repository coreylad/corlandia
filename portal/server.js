import express from "express";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "redis";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const app = express();
const port = Number(process.env.PORT || 3000);
const cortopiaHome = process.env.CORTOPIA_HOME || "/opt/cortopia";
const cortopiaBranch = process.env.CORTOPIA_BRANCH || "main";
const profileFile = join(cortopiaHome, "data", "enabled-apps.env");
const updateLogFile = join(cortopiaHome, "data", "update.log");
const appstoreUrl = process.env.CORTOPIA_APPSTORE_URL || "https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/appstore.xml";
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const cacheTtlSeconds = Number(process.env.APPSTORE_CACHE_TTL_SECONDS || 900);
const execFileAsync = promisify(execFile);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

let memoryCache = null;
let redis = null;

async function connectRedis() {
  redis = createClient({ url: redisUrl });
  redis.on("error", (error) => {
    console.warn(`Redis unavailable: ${error.message}`);
  });
  try {
    await redis.connect();
  } catch (error) {
    console.warn(`Redis connection failed, using memory cache: ${error.message}`);
    redis = null;
  }
}

function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeApp(app) {
  return {
    id: app.id,
    name: app.name || app.id,
    category: app.category || "Other",
    tagline: app.tagline || "",
    description: app.description || app.tagline || "",
    port: String(app.port || ""),
    path: app.path || "",
    url: app.url || "",
    weight: app.weight || "Light",
    image: app.image || "",
    website: app.website || "",
    repository: app.repository || "",
    docs: app.docs || "",
    featured: String(app.featured || "false") === "true",
    command: app.command || `cortopia install ${app.id}`,
  };
}

async function readProfiles() {
  try {
    const content = await readFile(profileFile, "utf8");
    const line = content.split(/\r?\n/).find((entry) => entry.startsWith("COMPOSE_PROFILES="));
    const value = line?.split("=").slice(1).join("=") || "portal";
    return new Set(value.split(",").map((profile) => profile.trim()).filter(Boolean));
  } catch {
    return new Set(["portal"]);
  }
}

async function writeProfiles(profiles) {
  const sortedProfiles = ["portal", ...[...profiles].filter((profile) => profile !== "portal").sort()];
  await mkdir(dirname(profileFile), { recursive: true });
  await writeFile(profileFile, `COMPOSE_PROFILES=${sortedProfiles.join(",")}\n`);
}

async function applyCompose() {
  const args = [
    "compose",
    "--env-file",
    ".env",
    "--env-file",
    "data/enabled-apps.env",
    "-f",
    "compose.yml",
    "-f",
    "compose.apps.yml",
    "up",
    "-d",
    "--remove-orphans",
  ];
  await execFileAsync("docker", args, { cwd: cortopiaHome, timeout: 120000 });
}

async function removeComposeService(appId) {
  try {
    await execFileAsync("docker", ["rm", "-f", `cortopia-${appId}`], { timeout: 60000 });
  } catch {
    // The container may already be gone after compose reconciles profiles.
  }
}

async function gitOutput(args, timeout = 30000) {
  const { stdout } = await execFileAsync("git", ["-c", `safe.directory=${cortopiaHome}`, ...args], { cwd: cortopiaHome, timeout });
  return stdout.trim();
}

async function composePs() {
  try {
    const { stdout } = await execFileAsync("docker", ["compose", "-f", "compose.yml", "-f", "compose.apps.yml", "ps", "--format", "json"], {
      cwd: cortopiaHome,
      timeout: 30000,
    });
    const output = stdout.trim();
    if (!output) return [];
    if (output.startsWith("[")) return JSON.parse(output);
    return output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function systemStatus({ refresh = false } = {}) {
  let localCommit = "";
  let remoteCommit = "";
  let updateAvailable = false;
  let updateLog = "";

  try {
    localCommit = await gitOutput(["rev-parse", "--short", "HEAD"]);
    if (refresh) {
      await gitOutput(["fetch", "origin", cortopiaBranch], 60000);
    }
    remoteCommit = await gitOutput(["rev-parse", "--short", `origin/${cortopiaBranch}`]);
    updateAvailable = localCommit !== remoteCommit;
  } catch (error) {
    updateLog = `Could not check git status: ${error.message}`;
  }

  try {
    updateLog = await readFile(updateLogFile, "utf8");
  } catch {
    // No update has been run yet.
  }

  return {
    branch: cortopiaBranch,
    localCommit,
    remoteCommit,
    updateAvailable,
    updateLog: updateLog.slice(-5000),
    containers: await composePs(),
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function startBackgroundUpdate() {
  await mkdir(dirname(updateLogFile), { recursive: true });
  const home = shellQuote(cortopiaHome);
  const branch = shellQuote(cortopiaBranch);
  const log = shellQuote(updateLogFile);
  const command = [
    `cd ${home}`,
    `echo "==> Cortopia update started at $(date -Is)" > ${log}`,
    `git -c safe.directory=${home} fetch origin ${branch} >> ${log} 2>&1`,
    `git -c safe.directory=${home} checkout ${branch} >> ${log} 2>&1`,
    `git -c safe.directory=${home} pull --ff-only origin ${branch} >> ${log} 2>&1`,
    `docker compose --env-file .env --env-file data/enabled-apps.env -f compose.yml -f compose.apps.yml up -d --build --remove-orphans >> ${log} 2>&1`,
    `echo "==> Cortopia update finished at $(date -Is)" >> ${log}`,
  ].join(" && ");
  const child = spawn("sh", ["-c", command], {
    cwd: cortopiaHome,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function getCachedJson() {
  if (redis?.isOpen) {
    const cached = await redis.get("appstore:json");
    if (cached) return JSON.parse(cached);
  }
  if (memoryCache && memoryCache.expiresAt > Date.now()) {
    return memoryCache.payload;
  }
  return null;
}

async function setCachedPayload(xml, payload) {
  memoryCache = {
    expiresAt: Date.now() + cacheTtlSeconds * 1000,
    payload,
  };
  if (redis?.isOpen) {
    await redis.set("appstore:xml", xml, { EX: cacheTtlSeconds });
    await redis.set("appstore:json", JSON.stringify(payload), { EX: cacheTtlSeconds });
  }
}

async function fetchAppstoreXml() {
  const response = await fetch(appstoreUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GitHub app store returned HTTP ${response.status}`);
  }
  return response.text();
}

async function loadAppstore({ refresh = false } = {}) {
  if (!refresh) {
    const cached = await getCachedJson();
    if (cached) return { ...cached, cached: true };
  }

  const xml = await fetchAppstoreXml();
  const parsed = parser.parse(xml);
  const apps = arrayify(parsed?.appstore?.app).map(normalizeApp);
  const payload = {
    source: appstoreUrl,
    fetchedAt: new Date().toISOString(),
    apps,
  };

  await setCachedPayload(xml, payload);
  return { ...payload, cached: false };
}

async function appsWithInstallState(options) {
  const [payload, profiles] = await Promise.all([
    loadAppstore(options),
    readProfiles(),
  ]);
  return {
    ...payload,
    apps: payload.apps.map((appEntry) => ({
      ...appEntry,
      installed: profiles.has(appEntry.id),
    })),
  };
}

function assertAppId(appId) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(appId)) {
    const error = new Error("Invalid app id");
    error.status = 400;
    throw error;
  }
}

async function findApp(appId) {
  const payload = await loadAppstore();
  const appEntry = payload.apps.find((entry) => entry.id === appId);
  if (!appEntry) {
    const error = new Error(`Unknown app: ${appId}`);
    error.status = 404;
    throw error;
  }
  return appEntry;
}

app.use(express.json());

app.use(express.static("public", {
  extensions: ["html"],
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    redis: Boolean(redis?.isOpen),
    appstoreUrl,
    cortopiaHome,
  });
});

app.get("/api/system", async (request, response) => {
  try {
    response.json(await systemStatus({ refresh: request.query.refresh === "1" }));
  } catch (error) {
    response.status(500).json({
      error: "Could not load system status",
      detail: error.message,
    });
  }
});

app.post("/api/system/update", async (_request, response) => {
  try {
    await startBackgroundUpdate();
    response.json({
      ok: true,
      message: "Update started. The dashboard may restart while the new version comes online.",
    });
  } catch (error) {
    response.status(500).json({
      error: "Could not start update",
      detail: error.message,
    });
  }
});

app.get("/api/apps", async (request, response) => {
  try {
    const payload = await appsWithInstallState({ refresh: request.query.refresh === "1" });
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      error: "Could not load GitHub XML app store",
      detail: error.message,
    });
  }
});

app.post("/api/apps/:id/install", async (request, response) => {
  try {
    const appId = request.params.id;
    assertAppId(appId);
    await findApp(appId);
    const profiles = await readProfiles();
    profiles.add("portal");
    profiles.add(appId);
    await writeProfiles(profiles);
    await applyCompose();
    response.json(await appsWithInstallState());
  } catch (error) {
    response.status(error.status || 500).json({
      error: "Could not install app",
      detail: error.message,
    });
  }
});

app.post("/api/apps/:id/uninstall", async (request, response) => {
  try {
    const appId = request.params.id;
    assertAppId(appId);
    await findApp(appId);
    const profiles = await readProfiles();
    profiles.delete(appId);
    profiles.add("portal");
    await writeProfiles(profiles);
    await applyCompose();
    await removeComposeService(appId);
    response.json(await appsWithInstallState());
  } catch (error) {
    response.status(error.status || 500).json({
      error: "Could not uninstall app",
      detail: error.message,
    });
  }
});

app.get("/api/appstore.xml", async (_request, response) => {
  try {
    if (redis?.isOpen) {
      const cached = await redis.get("appstore:xml");
      if (cached) {
        response.type("application/xml").send(cached);
        return;
      }
    }
    const xml = await fetchAppstoreXml();
    response.type("application/xml").send(xml);
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

await connectRedis();
app.listen(port, () => {
  console.log(`Cortopia portal listening on ${port}`);
});
