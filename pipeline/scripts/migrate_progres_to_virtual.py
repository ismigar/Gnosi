#!/usr/bin/env python3.11
"""Converts the "Progrés" field in the Projectes table into a DERIVED (virtual) field.

Quoted field and option labels below are persisted data. @language-example

From a `number` with hand-saved 0-1 fractions → `virtual` with `compute=task_progress`
(% of related Tasques with Estat="Fet", calculated on read by the backend).

Idempotent: if it's already virtual with the correct compute, does nothing.
Defaults to DRY-RUN (shows the change). Requires `--apply` to write (with backup).

See: docs/dev_memory/directives/vault_derived_progress_field.md

WARNING: the backend serving the vault MUST HAVE the `task_progress` computer
(backend/api/virtual_fields.py) active BEFORE applying; otherwise, Progrés will show
EMPTY until the code is deployed. After applying, restart the native backend
and invalidate the page-index cache.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime

REGISTRY = os.path.expanduser("~/Library/CloudStorage/OneDrive-UNED/Gnosi/BD/vault_db_registry.json")
PROJECTS_TABLE_ID = "8e8d3c8d38e64ea0ac417b65561c7712"
TASKS_TABLE_ID = "ebe5e40f334745779d1c589de14f15a4"
FIELD_NAME = "Progrés"

VIRTUAL_PROP = {
    "name": FIELD_NAME,
    "id": "fld_ba83d2a5",
    "type": "virtual",
    "compute": "task_progress",
    "config": {
        "source_table_id": TASKS_TABLE_ID,
        "relation_field": "Projecte",
        "status_field": "Estat",
        "done_value": "Fet",
    },
    "format": {"kind": "percent", "decimals": 0},
}


def _tables(reg):
    if isinstance(reg, list):
        return reg
    for key in ("tables", "databases"):
        if isinstance(reg.get(key), list):
            return reg[key]
    raise SystemExit("No 'tables' collection was found in the registry")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes (with a backup). Without this flag, run in dry-run mode.",
    )
    args = ap.parse_args()

    with open(REGISTRY, encoding="utf-8") as f:
        reg = json.load(f)

    table = next((t for t in _tables(reg) if t.get("id") == PROJECTS_TABLE_ID), None)
    if not table:
        raise SystemExit(f"Projectes table {PROJECTS_TABLE_ID} was not found")

    props = table.get("properties") or []
    idx = next((i for i, p in enumerate(props) if p.get("name") == FIELD_NAME), None)
    if idx is None:
        raise SystemExit(f"Field '{FIELD_NAME}' was not found in Projectes")

    current = props[idx]
    print(f"CURRENT PROPERTY: {json.dumps(current, ensure_ascii=False)}")
    print(f"NEW PROPERTY    : {json.dumps(VIRTUAL_PROP, ensure_ascii=False)}")

    if current.get("type") == "virtual" and current.get("compute") == "task_progress":
        print("\n✓ The property is already virtual with compute=task_progress; nothing to do.")
        return

    if not args.apply:
        print("\n[DRY-RUN] Nothing was written. Run again with --apply to apply the change.")
        return

    backup = f"{REGISTRY}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(REGISTRY, backup)
    print(f"\nBackup → {backup}")

    props[idx] = VIRTUAL_PROP
    with open(REGISTRY, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=2)
    print("✓ Registry updated. Restart the native backend and invalidate the page-index cache.")


if __name__ == "__main__":
    main()
