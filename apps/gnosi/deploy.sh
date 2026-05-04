#!/bin/bash

# Force connection to the system socket to avoid configuration issues
export DOCKER_HOST=unix:///var/run/docker.sock

echo "🐳 Deploying Digital Brain Setup..."
echo "Using Socket: $DOCKER_HOST"

# Stop existing containers if any (ignore errors)
docker-compose down 2>/dev/null

# Build and Start
docker-compose up --build
