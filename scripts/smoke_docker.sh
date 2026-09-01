#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repository_root}/.github/docker-compose.smoke.yml"
smoke_project="${GNOSI_DOCKER_SMOKE_PROJECT:-gnosi-ci-smoke}"
backend_port="${GNOSI_BACKEND_PORT:-15002}"
frontend_port="${GNOSI_FRONTEND_PORT:-15173}"
marker="gnosi-docker-smoke-${smoke_project}"

case "${smoke_project}" in
  (*[!a-zA-Z0-9_-]*|'')
    echo "GNOSI_DOCKER_SMOKE_PROJECT must contain only letters, numbers, underscores or hyphens" >&2
    exit 2
    ;;
esac

export COMPOSE_PROJECT_NAME="${smoke_project}"
export GNOSI_BACKEND_PORT="${backend_port}"
export GNOSI_FRONTEND_PORT="${frontend_port}"
export GNOSI_JWT_SECRET="${GNOSI_JWT_SECRET:-synthetic-ci-smoke-secret-not-for-production}"

compose() {
  docker compose --file "${compose_file}" "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_http() {
  local url="$1"
  local attempts=60
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --fail --silent --show-error --max-time 3 "${url}" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  compose ps >&2 || true
  compose logs --no-color --tail 200 >&2 || true
  echo "Timed out waiting for ${url}" >&2
  return 1
}

compose up --detach --no-build backend frontend
wait_http "http://127.0.0.1:${backend_port}/api/health"
wait_http "http://127.0.0.1:${frontend_port}/vault"

backend_container="$(compose ps --quiet backend)"
test -n "${backend_container}"
docker exec "${backend_container}" sh -c 'printf "%s" "$1" > /data/.gnosi-smoke-persistence' sh "${marker}"

compose down --remove-orphans
compose up --detach --no-build backend frontend
wait_http "http://127.0.0.1:${backend_port}/api/health"
wait_http "http://127.0.0.1:${frontend_port}/vault"

backend_container="$(compose ps --quiet backend)"
persisted="$(docker exec "${backend_container}" cat /data/.gnosi-smoke-persistence)"
test "${persisted}" = "${marker}"

echo "Docker smoke passed with persistent /data and live backend/frontend."
