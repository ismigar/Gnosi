"""Regenerate the vendored model catalog from models.dev.

Usage (from monorepo/apps/gnosi, venv active):

    python -m backend.scripts.refresh_model_catalog

Downloads https://models.dev/api.json, transforms it with
`backend.agent.model_catalog.build_catalog`, and rewrites
`backend/data/model_catalog.json` — the zero-network fallback the API serves
when neither the remote fetch nor the disk cache is available. Idempotent;
run it whenever the vendored snapshot feels stale (providers release models
weekly, the runtime refreshes itself daily anyway).
"""
from __future__ import annotations

import json
import sys

import requests

from backend.agent.model_catalog import MODELS_DEV_URL, VENDORED_PATH, build_catalog


def main() -> int:
    print(f"Fetching {MODELS_DEV_URL} …")
    resp = requests.get(MODELS_DEV_URL, timeout=30)
    resp.raise_for_status()
    catalog = build_catalog(resp.json())
    if not catalog["providers"]:
        print("ERROR: transform produced 0 providers; vendored file NOT touched.")
        return 1
    VENDORED_PATH.parent.mkdir(parents=True, exist_ok=True)
    VENDORED_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    n_models = sum(len(p["models"]) for p in catalog["providers"])
    print(f"Wrote {VENDORED_PATH} — {len(catalog['providers'])} providers, {n_models} models.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
