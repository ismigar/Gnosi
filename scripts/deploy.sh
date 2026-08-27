#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GNOSI_DIR="$(dirname "$SCRIPT_DIR")"
cd "$GNOSI_DIR"

# Force connection to the system socket to avoid configuration issues
export DOCKER_HOST=unix:///var/run/docker.sock

echo "🐳 Deploying Gnosi Setup..."
echo "Using Socket: $DOCKER_HOST"

# Stop existing containers if any (ignore errors)
docker compose down 2>/dev/null || true

# Build and Start
docker compose up --build
