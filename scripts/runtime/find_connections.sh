#!/bin/bash
set -euo pipefail

# Resolve separately so a failed dirname cannot silently select another root.
SCRIPT_DIR="$(dirname -- "${BASH_SOURCE[0]}")"
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

cd -- "$PROJECT_ROOT"

# Run the same canonical Brain proposal service as the Gnosi scheduler.
# Use the existing frozen root environment; never synchronize dependencies here.
echo "🚀 Running Brain connection analysis..."
exec uv run --project "$PROJECT_ROOT" --frozen --no-sync python -c 'import json; from backend.services.llm_wiki_actions import run_maintenance; print(json.dumps(run_maintenance(semantic=True), ensure_ascii=False))'
