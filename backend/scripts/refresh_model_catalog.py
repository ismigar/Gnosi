"""Regenerate the vendored model catalog from models.dev.

Usage (from Gnosi, venv active):

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


def _without_timestamp(catalog: dict) -> dict:
    stripped = dict(catalog)
    stripped.pop("generated_at", None)
    return stripped


def main() -> int:
    print(f"Fetching {MODELS_DEV_URL} …")
    resp = requests.get(MODELS_DEV_URL, timeout=30)
    resp.raise_for_status()
    catalog = build_catalog(resp.json())
    # Sanity floor: the snapshot is auto-merged by CI, so a half-empty catalog
    # (upstream format change, truncated response) must fail loudly instead of
    # silently replacing a good file. Today's real numbers (full catalog, no
    # whitelist): ~167 providers, ~5500 models.
    n_providers = len(catalog["providers"])
    n_models = sum(len(p["models"]) for p in catalog["providers"])
    if n_providers < 50 or n_models < 1000:
        print(f"ERROR: suspiciously small catalog ({n_providers} providers, "
              f"{n_models} models); vendored file NOT touched.")
        return 1
    # Skip the write when only `generated_at` would change: the weekly CI run
    # diffs the file to decide whether to open a PR, and a bare timestamp bump
    # would open one every week with no data change.
    if VENDORED_PATH.exists():
        try:
            current = json.loads(VENDORED_PATH.read_text(encoding="utf-8"))
        except Exception:
            current = None
        if current and _without_timestamp(current) == _without_timestamp(catalog):
            print("No data changes (ignoring generated_at); vendored file left untouched.")
            return 0
    VENDORED_PATH.parent.mkdir(parents=True, exist_ok=True)
    VENDORED_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {VENDORED_PATH} — {n_providers} providers, {n_models} models.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
