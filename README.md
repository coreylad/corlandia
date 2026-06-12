# Cortopia Homelab

A tiny homelab "OS-style" experience for low-powered media servers: one command installs a slick Node-powered homepage, a Redis-backed GitHub XML app store, and a `cortopia` command for managing self-hosted apps with Docker Compose.

## One-command install

After pushing this repo to GitHub, replace `YOUR_USER/YOUR_REPO` with the real repo path:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/install.sh | CORTOPIA_REPO=YOUR_USER/YOUR_REPO bash
```

For a custom install directory or port:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/install.sh | CORTOPIA_REPO=YOUR_USER/YOUR_REPO CORTOPIA_HOME=/srv/cortopia CORTOPIA_PORT=8088 bash
```

Then open:

```text
http://SERVER_IP:8080
```

## CLI

```bash
cortopia status
cortopia apps
cortopia install jellyfin
cortopia install jellyseerr
cortopia install navidrome
cortopia uninstall jellyfin
cortopia logs
```

## What It Includes

- A lightweight Node dashboard with a Redis cache.
- A Docker Compose stack for the portal.
- Optional app profiles for media, downloads, monitoring, and utilities.
- Persistent config under `data/`.
- A simple CLI copied to `/usr/local/bin/cortopia` when permissions allow.

## App Notes

The app store reads `appstore.xml` directly from GitHub raw through the Node dashboard API, then caches the XML and parsed app list in Redis. Catalog data does not need to live on the server. Update `CORTOPIA_APPSTORE_URL` in `.env` after publishing the repo, or set it during install:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/install.sh | CORTOPIA_REPO=YOUR_USER/YOUR_REPO CORTOPIA_APPSTORE_URL=https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/appstore.xml bash
```

Installed apps are managed as Docker Compose services using profiles in `compose.apps.yml`. The CLI validates against the GitHub XML app store, enables apps by updating `data/enabled-apps.env`, then recreates the stack with the selected profiles.

Apps are intentionally boring under the hood because boring is what survives at 2 a.m. on a little home server.

## Dashboard API

```text
GET /api/health
GET /api/apps
GET /api/apps?refresh=1
GET /api/appstore.xml
```
