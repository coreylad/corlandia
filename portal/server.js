import express from "express";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "redis";

const app = express();
const port = Number(process.env.PORT || 3000);
const appstoreUrl = process.env.CORTOPIA_APPSTORE_URL || "https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/appstore.xml";
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const activeProfiles = new Set((process.env.ACTIVE_PROFILES || "portal").split(",").map((profile) => profile.trim()));
const cacheTtlSeconds = Number(process.env.APPSTORE_CACHE_TTL_SECONDS || 900);
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
    port: String(app.port || ""),
    path: app.path || "",
    weight: app.weight || "Light",
    command: app.command || `cortopia install ${app.id}`,
    installed: activeProfiles.has(app.id),
  };
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

app.use(express.static("public", {
  extensions: ["html"],
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    redis: Boolean(redis?.isOpen),
    appstoreUrl,
  });
});

app.get("/api/apps", async (request, response) => {
  try {
    const payload = await loadAppstore({ refresh: request.query.refresh === "1" });
    response.json(payload);
  } catch (error) {
    response.status(502).json({
      error: "Could not load GitHub XML app store",
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
