# Cortopia Homelab

A tiny homelab "OS-style" experience for low-powered media servers: one command installs a slick Node-powered homepage, a Redis-backed GitHub XML app store, and a `cortopia` command for managing self-hosted apps with Docker Compose.

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/coreylad/corlandia/main/install.sh | CORTOPIA_REPO=coreylad/corlandia bash
```

The installer bootstraps missing prerequisites where possible, including `git`, `curl`, Docker Engine, and Docker Compose. It needs root or `sudo` access to install system packages.

For a custom install directory or port:

```bash
curl -fsSL https://raw.githubusercontent.com/coreylad/corlandia/main/install.sh | CORTOPIA_REPO=coreylad/corlandia CORTOPIA_HOME=/srv/cortopia CORTOPIA_PORT=8088 bash
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
- Apps can be installed and uninstalled directly from the dashboard.
- The dashboard can check for new GitHub versions and update itself.
- A Docker Compose stack for the portal.
- Optional app profiles for media, automation, downloads, audio, files, photos, monitoring, Docker, security, productivity, and smart home.
- Persistent config under `data/`.
- A simple CLI copied to `/usr/local/bin/cortopia` when permissions allow.

## App Notes

The app store reads `appstore.xml` directly from GitHub raw through the Node dashboard API, then caches the XML and parsed app list in Redis. Catalog data does not need to live on the server. Update `CORTOPIA_APPSTORE_URL` in `.env` after publishing the repo, or set it during install:

```bash
curl -fsSL https://raw.githubusercontent.com/coreylad/corlandia/main/install.sh | CORTOPIA_REPO=coreylad/corlandia CORTOPIA_APPSTORE_URL=https://raw.githubusercontent.com/coreylad/corlandia/main/appstore.xml bash
```

Installed apps are managed as Docker Compose services using profiles in `compose.apps.yml`. The CLI validates against the GitHub XML app store, enables apps by updating `data/enabled-apps.env`, then recreates the stack with the selected profiles.

The dashboard can do the same install/uninstall work from the browser. To make that possible, the portal container mounts the Docker socket and the Cortopia install directory. Only run Cortopia on a trusted home network.

The app store catalog is `appstore.xml` on GitHub. The dashboard reads app names, categories, descriptions, container images, docs, repositories, and launch links from that XML feed, then caches it in Redis. Use the dashboard refresh button to pull the latest XML immediately.

Apps are intentionally boring under the hood because boring is what survives at 2 a.m. on a little home server.

## Dashboard API

```text
GET /api/health
GET /api/system
GET /api/system?refresh=1
GET /api/apps
GET /api/apps?refresh=1
GET /api/appstore.xml
POST /api/apps/:id/install
POST /api/apps/:id/uninstall
POST /api/system/update
```
