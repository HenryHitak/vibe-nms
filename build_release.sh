#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="$ROOT_DIR/vibe-nms-release"
ZIP_PATH="$ROOT_DIR/vibe-nms-release.zip"

rm -rf "$RELEASE_DIR" "$ZIP_PATH"
mkdir -p "$RELEASE_DIR"

cp -R "$ROOT_DIR/backend" "$RELEASE_DIR/backend"
cp -R "$ROOT_DIR/frontend" "$RELEASE_DIR/frontend"
cp -R "$ROOT_DIR/nginx" "$RELEASE_DIR/nginx"
rm -rf "$RELEASE_DIR/frontend/node_modules" "$RELEASE_DIR/frontend/dist" "$RELEASE_DIR/frontend/.vite"
find "$RELEASE_DIR" -type d -name "__pycache__" -prune -exec rm -rf {} +
cp "$ROOT_DIR/docker-compose.yml" "$RELEASE_DIR/docker-compose.yml"
cp "$ROOT_DIR/.env.example" "$RELEASE_DIR/.env.example"
cp "$ROOT_DIR/README.md" "$RELEASE_DIR/README.md"
cp "$ROOT_DIR/build_release.ps1" "$RELEASE_DIR/build_release.ps1"
cp "$ROOT_DIR/build_release.sh" "$RELEASE_DIR/build_release.sh"

(cd "$RELEASE_DIR" && zip -r "$ZIP_PATH" .)
echo "Created $ZIP_PATH"
