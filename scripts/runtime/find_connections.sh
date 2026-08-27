#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Navigate to project root
cd "$PROJECT_ROOT"

# Run the same canonical Brain proposal service as the Gnosi scheduler.
echo "🚀 Running Brain connection analysis..."
uv run python -c 'import json; from backend.services.llm_wiki_actions import run_maintenance; print(json.dumps(run_maintenance(semantic=True), ensure_ascii=False))'
