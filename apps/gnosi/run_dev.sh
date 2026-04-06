#!/bin/bash
# run_dev.sh
# Executa el backend amb auto-reload per a permetre l'auto-millora immediata.

# Assegurar que som al directori correcte
cd "$(dirname "$0")"

# Activar entorn virtual si existeix
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

echo "🚀 Starting Digital Brain Backend (Dev Mode with --reload)..."
# Executar uvicorn amb reload actiu
uvicorn backend.server:app --host 0.0.0.0 --port 5002 --reload
