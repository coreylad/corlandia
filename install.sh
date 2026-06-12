#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CORTOPIA_HOME:-/opt/cortopia}"
PORT="${CORTOPIA_PORT:-8080}"
BRANCH="${CORTOPIA_BRANCH:-main}"
REPO_SLUG="${CORTOPIA_REPO:-YOUR_USER/YOUR_REPO}"
REPO_URL="${CORTOPIA_REPO_URL:-https://github.com/${REPO_SLUG}.git}"
APPSTORE_URL="${CORTOPIA_APPSTORE_URL:-https://raw.githubusercontent.com/${REPO_SLUG}/${BRANCH}/appstore.xml}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo "Docker Compose is required. Install Docker Engine with Compose, then rerun this installer." >&2
    exit 1
  fi
}

as_root_copy() {
  local src="$1"
  local dest="$2"
  if [ "$(id -u)" -eq 0 ]; then
    cp "$src" "$dest"
    chmod +x "$dest"
  elif command -v sudo >/dev/null 2>&1; then
    sudo cp "$src" "$dest"
    sudo chmod +x "$dest"
  else
    echo "Could not install global cortopia command; sudo is unavailable."
    echo "Use ${INSTALL_DIR}/bin/cortopia instead."
  fi
}

echo "==> Installing Cortopia Homelab"
need_cmd git
need_cmd docker
COMPOSE="$(compose_cmd)"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "==> Updating ${INSTALL_DIR}"
  if [ -w "$INSTALL_DIR" ]; then
    git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  elif command -v sudo >/dev/null 2>&1; then
    sudo git -C "$INSTALL_DIR" fetch origin "$BRANCH"
    sudo git -C "$INSTALL_DIR" checkout "$BRANCH"
    sudo git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
    sudo chown -R "$USER":"$USER" "$INSTALL_DIR"
  else
    echo "Cannot update ${INSTALL_DIR}; it is not writable and sudo is unavailable." >&2
    exit 1
  fi
else
  echo "==> Cloning ${REPO_URL} into ${INSTALL_DIR}"
  if [ "$(id -u)" -eq 0 ]; then
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  elif command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p "$(dirname "$INSTALL_DIR")"
    sudo git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    sudo chown -R "$USER":"$USER" "$INSTALL_DIR"
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
fi

mkdir -p "$INSTALL_DIR/data"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
fi

if ! grep -q '^CORTOPIA_PORT=' "$INSTALL_DIR/.env"; then
  echo "CORTOPIA_PORT=${PORT}" >> "$INSTALL_DIR/.env"
else
  sed -i "s/^CORTOPIA_PORT=.*/CORTOPIA_PORT=${PORT}/" "$INSTALL_DIR/.env"
fi

if ! grep -q '^CORTOPIA_APPSTORE_URL=' "$INSTALL_DIR/.env"; then
  echo "CORTOPIA_APPSTORE_URL=${APPSTORE_URL}" >> "$INSTALL_DIR/.env"
else
  sed -i "s|^CORTOPIA_APPSTORE_URL=.*|CORTOPIA_APPSTORE_URL=${APPSTORE_URL}|" "$INSTALL_DIR/.env"
fi

if [ ! -f "$INSTALL_DIR/data/enabled-apps.env" ]; then
  printf 'COMPOSE_PROFILES=portal\n' > "$INSTALL_DIR/data/enabled-apps.env"
fi

echo "==> Installing cortopia command"
as_root_copy "$INSTALL_DIR/bin/cortopia" /usr/local/bin/cortopia

echo "==> Starting portal"
cd "$INSTALL_DIR"
$COMPOSE --env-file .env --env-file data/enabled-apps.env -f compose.yml -f compose.apps.yml up -d

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo
echo "Cortopia is live."
echo "Open: http://${IP:-SERVER_IP}:${PORT}"
echo "Run:  cortopia apps"
