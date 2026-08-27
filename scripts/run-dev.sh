#!/bin/bash
# Executa el backend i el frontend natius amb els toolchains bloquejats.

# Assegurar que som al directori correcte
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GNOSI_DIR="$(dirname "$SCRIPT_DIR")"
cd "$GNOSI_DIR"

echo "🚀 Starting Gnosi in native development mode..."
exec pnpm dev
