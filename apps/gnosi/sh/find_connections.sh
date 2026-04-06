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

# Run the pipeline
echo "🚀 Running suggest_connections_digital_brain..."
python3 -m pipeline.skills.suggest_connections_digital_brain
