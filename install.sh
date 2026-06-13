#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${CORTOPIA_HOME:-/opt/cortopia}"
PORT="${CORTOPIA_PORT:-80}"
BRANCH="${CORTOPIA_BRANCH:-main}"
REPO_SLUG="${CORTOPIA_REPO:-YOUR_USER/YOUR_REPO}"
REPO_URL="${CORTOPIA_REPO_URL:-https://github.com/${REPO_SLUG}.git}"
APPSTORE_URL="${CORTOPIA_APPSTORE_URL:-https://raw.githubusercontent.com/${REPO_SLUG}/${BRANCH}/appstore.xml}"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have_cmd sudo; then
    sudo "$@"
  else
    echo "This installer needs root privileges to install prerequisites." >&2
    echo "Install sudo or rerun as root." >&2
    exit 1
  fi
}

pkg_install() {
  if have_cmd apt-get; then
    run_root apt-get update
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  elif have_cmd dnf; then
    run_root dnf install -y "$@"
  elif have_cmd yum; then
    run_root yum install -y "$@"
  elif have_cmd apk; then
    run_root apk add --no-cache "$@"
  elif have_cmd pacman; then
    run_root pacman -Sy --noconfirm "$@"
  else
    echo "Could not find a supported package manager." >&2
    echo "Install git, curl, Docker Engine, and Docker Compose, then rerun this installer." >&2
    exit 1
  fi
}

ensure_base_packages() {
  local packages=()
  have_cmd git || packages+=("git")
  have_cmd curl || packages+=("curl")

  if [ "${#packages[@]}" -gt 0 ]; then
    echo "==> Installing base prerequisites: ${packages[*]}"
    if have_cmd apk; then
      pkg_install "${packages[@]}" ca-certificates
    else
      pkg_install "${packages[@]}" ca-certificates
    fi
  fi
}

start_docker() {
  if have_cmd systemctl; then
    run_root systemctl enable --now docker >/dev/null 2>&1 || true
  elif have_cmd service; then
    run_root service docker start >/dev/null 2>&1 || true
  fi
}

install_docker() {
  if have_cmd docker; then
    start_docker
    return
  fi

  echo "==> Installing Docker Engine"
  ensure_base_packages
  curl -fsSL https://get.docker.com -o /tmp/cortopia-get-docker.sh
  run_root sh /tmp/cortopia-get-docker.sh
  start_docker
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    echo "docker"
  elif have_cmd sudo && sudo docker info >/dev/null 2>&1; then
    echo "sudo docker"
  else
    echo "Docker is installed, but this user cannot talk to the Docker daemon." >&2
    echo "Add the user to the docker group, log out and back in, or run the installer with sudo." >&2
    exit 1
  fi
}

install_compose() {
  local docker
  docker="$(docker_cmd)"
  if $docker compose version >/dev/null 2>&1 || have_cmd docker-compose; then
    return
  fi

  echo "==> Installing Docker Compose"
  if have_cmd apt-get; then
    pkg_install docker-compose-plugin
  elif have_cmd dnf || have_cmd yum; then
    pkg_install docker-compose-plugin
  elif have_cmd apk; then
    pkg_install docker-cli-compose
  elif have_cmd pacman; then
    pkg_install docker-compose
  fi
}

compose_cmd() {
  local docker
  docker="$(docker_cmd)"
  if $docker compose version >/dev/null 2>&1; then
    echo "$docker compose"
  elif have_cmd docker-compose; then
    echo "docker-compose"
  else
    echo "Docker Compose is required but could not be installed automatically." >&2
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
echo "==> Installer version: 2026-06-13-prereq-bootstrap"
ensure_base_packages
install_docker
install_compose
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

if ! grep -q '^CORTOPIA_HOME=' "$INSTALL_DIR/.env"; then
  echo "CORTOPIA_HOME=${INSTALL_DIR}" >> "$INSTALL_DIR/.env"
else
  sed -i "s|^CORTOPIA_HOME=.*|CORTOPIA_HOME=${INSTALL_DIR}|" "$INSTALL_DIR/.env"
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
