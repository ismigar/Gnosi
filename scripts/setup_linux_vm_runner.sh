#!/usr/bin/env bash
set -euo pipefail

# Setup script for Linux ARM64 VM using Lima and GitHub Actions runner
# Usage: ./scripts/setup_linux_vm_runner.sh <RUNNER_TOKEN> [REPO_URL]

RUNNER_TOKEN="${1:-}"
REPO_URL="${2:-https://github.com/ismigar/Projectes}"
VM_NAME="gnosi-linux-runner"
RUNNER_VERSION="2.322.0"

if [ -z "${RUNNER_TOKEN}" ]; then
  echo "Error: GitHub runner token is required."
  echo "Usage: $0 <RUNNER_TOKEN> [REPO_URL]"
  echo "Get a token from: GitHub Repository -> Settings -> Actions -> Runners -> New self-hosted runner"
  exit 1
fi

if ! command -v limactl &>/dev/null; then
  echo "Error: limactl is not installed. Installing via brew..."
  brew install lima
fi

echo "==> Checking if Lima instance '${VM_NAME}' exists..."
if ! limactl list --json | grep -q "\"name\":\"${VM_NAME}\""; then
  echo "==> Creating Lima Linux VM '${VM_NAME}'..."
  limactl create --name="${VM_NAME}" \
    --cpus=4 \
    --memory=4 \
    --disk=30 \
    --containerd=user \
    template://ubuntu
fi

echo "==> Ensuring Lima Linux VM '${VM_NAME}' is running..."
if ! limactl list --json | grep "\"name\":\"${VM_NAME}\"" | grep -q "\"status\":\"Running\""; then
  limactl start "${VM_NAME}"
fi

echo "==> Provisioning build tools and dependencies inside Linux VM..."
limactl shell "${VM_NAME}" sudo bash -c '
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y \
    build-essential \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    libgtk-3-dev \
    libnss3-dev \
    libasound2 \
    libgbm-dev \
    fakeroot \
    rpm \
    dpkg-dev

  if ! command -v node &>/dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
'

echo "==> Setting up GitHub Actions runner inside Linux VM..."
limactl shell "${VM_NAME}" bash -c "
  set -euo pipefail
  mkdir -p ~/actions-runner-linux
  cd ~/actions-runner-linux

  if [ ! -f 'config.sh' ]; then
    echo 'Downloading Linux ARM64 runner...'
    curl -sFl -o 'actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz' \
      'https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz'
    tar xzf './actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz'
    rm -f './actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz'
  fi

  echo 'Configuring Linux runner...'
  ./config.sh \
    --url '${REPO_URL}' \
    --token '${RUNNER_TOKEN}' \
    --name 'Linux-ARM64-Lima-Runner' \
    --labels 'self-hosted,Linux,ARM64' \
    --unattended \
    --replace
"

echo "==> Linux runner successfully configured inside VM '${VM_NAME}'."
echo "To start the runner service inside the VM:"
echo "  limactl shell ${VM_NAME} bash -c 'cd ~/actions-runner-linux && ./run.sh'"
echo "Or to install systemd service inside VM:"
echo "  limactl shell ${VM_NAME} sudo bash -c 'cd /home/\$USER.linux/actions-runner-linux && ./svc.sh install && ./svc.sh start'"
