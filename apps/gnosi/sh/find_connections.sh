#!/bin/bash

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Navigate to project root
cd "$PROJECT_ROOT"

# Activate virtual environment if not already activated
if [[ -z "$VIRTUAL_ENV" ]]; then
    if [[ -d ".venv" ]]; then
        source .venv/bin/activate
    elif [[ -d "venv" ]]; then
        source venv/bin/activate
    else
        echo "❌ Virtual environment not found (.venv or venv)"
        exit 1
    fi
fi

# Run the same canonical Brain proposal service as the Gnosi scheduler.
echo "🚀 Running Brain connection analysis..."
python3 -c 'import json; from backend.services.llm_wiki_actions import run_maintenance; print(json.dumps(run_maintenance(semantic=True), ensure_ascii=False))'
