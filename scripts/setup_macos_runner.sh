#!/usr/bin/env bash
set -euo pipefail

# Setup script for macOS self-hosted GitHub Actions runner
# Usage: ./scripts/setup_macos_runner.sh <RUNNER_TOKEN> [REPO_URL]

RUNNER_TOKEN="${1:-}"
REPO_URL="${2:-https://github.com/ismigar/Projectes}"
RUNNER_DIR="${HOME}/actions-runner-macos"
RUNNER_VERSION="2.322.0" # Current stable runner version

if [ -z "${RUNNER_TOKEN}" ]; then
  echo "Error: GitHub runner token is required."
  echo "Usage: $0 <RUNNER_TOKEN> [REPO_URL]"
  echo "Get a token from: GitHub Repository -> Settings -> Actions -> Runners -> New self-hosted runner"
  exit 1
fi

echo "==> Setting up macOS self-hosted runner in ${RUNNER_DIR}..."

mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

if [ ! -f "config.sh" ]; then
  echo "==> Downloading GitHub Actions runner package..."
  curl -sFl -o "actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
  
  tar xzf "./actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
  rm -f "./actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
fi

echo "==> Configuring runner for repository ${REPO_URL}..."
./config.sh \
  --url "${REPO_URL}" \
  --token "${RUNNER_TOKEN}" \
  --name "macOS-Local-Runner" \
  --labels "self-hosted,macOS,ARM64" \
  --unattended \
  --replace

echo "==> macOS runner successfully configured."
echo "To start the runner, run:"
echo "  cd ${RUNNER_DIR} && ./run.sh"
echo "Or to install as a persistent service:"
echo "  cd ${RUNNER_DIR} && ./svc.sh install && ./svc.sh start"
