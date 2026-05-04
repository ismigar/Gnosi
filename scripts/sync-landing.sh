#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! git remote get-url landing >/dev/null 2>&1; then
  echo "Error: falta el remoto 'landing'." >&2
  echo "Ejecuta: git remote add landing git@github.com:ismigar/ismigar.github.io.git" >&2
  exit 1
fi

if [[ ! -f "ismigar.github.io/index.html" ]]; then
  echo "Error: falta ismigar.github.io/index.html" >&2
  exit 1
fi

TMP_DIR=".tmp/landing_publish"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

# Copia el estado actual de la carpeta landing y elimina residuos previos.
rsync -a --delete "ismigar.github.io/" "$TMP_DIR/"

pushd "$TMP_DIR" >/dev/null

git init -b main >/dev/null
git add .
git -c user.name="ismigar-sync" -c user.email="sync@local" commit -m "sync landing" >/dev/null
git remote add origin "$(git -C "$ROOT_DIR" remote get-url landing)"
git push --force origin main

popd >/dev/null
rm -rf "$TMP_DIR"

echo "Landing sincronizada en ismigar/ismigar.github.io (main)."
