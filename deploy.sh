#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# --- Prerequisites ---
for cmd in node npm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ Error: '$cmd' is not installed. Please install it first."
    exit 1
  fi
done

# --- Install dependencies ---
echo "Installing dependencies..."
npm install

# --- Build frontend ---
echo "Building frontend..."
VITE_API_BASE_URL=/api npm run build

# --- Inject auth guard ---
echo "Injecting auth guard..."
bash deploy/inject-auth-guard.sh

# --- Create data directory ---
mkdir -p deploy/data

# --- Initialize saved-directories.json if missing ---
if [ ! -f deploy/data/saved-directories.json ]; then
  echo '{"savedDirectories":[],"recentProjects":{}}' > deploy/data/saved-directories.json
  echo "Initialized deploy/data/saved-directories.json"
fi

# --- Initialize SQLite database if missing ---
if [ ! -f deploy/data/opencode.db ]; then
  touch deploy/data/opencode.db
  echo "Created SQLite database: deploy/data/opencode.db"
fi

# --- Set ownership for nginx worker ---
chown -R www:www deploy/data/

# --- Validate nginx config ---
echo "Validating nginx config..."
if ! nginx -t 2>&1; then
  echo "❌ Nginx config validation failed. Aborting deploy."
  exit 1
fi

# --- Reload nginx ---
echo "Reloading nginx..."
if ! nginx -s reload; then
    echo "❌ Nginx reload failed. Check nginx error logs."
    exit 1
fi

echo "✅ Deploy complete! Open: http://$(hostname -I | awk '{print $1}'):3100"
