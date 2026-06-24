#!/usr/bin/env python3.11
"""Converteix el camp «Progrés» de la taula Projectes a un camp DERIVAT (virtual).

D'un `number` amb fraccions 0-1 desades a mà → `virtual` amb `compute=task_progress`
(% de Tasques relacionades amb Estat="Fet", calculat en llegir pel backend).

Idempotent: si ja és virtual amb el compute correcte, no fa res.
Per defecte fa DRY-RUN (mostra el canvi). Cal `--apply` per escriure (amb backup).

Veure: docs/dev_memory/directives/vault_derived_progress_field.md

ATENCIÓ: el backend que serveix el vault HA DE TENIR el computer `task_progress`
(backend/api/virtual_fields.py) actiu ABANS d'aplicar; si no, Progrés es veurà
BUIT fins que el codi es desplegui. Després d'aplicar, reinicia el backend natiu
i invalida el page-index cache.
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
    raise SystemExit("No s'han trobat 'tables' al registry")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Escriu els canvis (amb backup). Sense això: dry-run.")
    args = ap.parse_args()

    with open(REGISTRY, encoding="utf-8") as f:
        reg = json.load(f)

    table = next((t for t in _tables(reg) if t.get("id") == PROJECTS_TABLE_ID), None)
    if not table:
        raise SystemExit(f"Taula Projectes {PROJECTS_TABLE_ID} no trobada")

    props = table.get("properties") or []
    idx = next((i for i, p in enumerate(props) if p.get("name") == FIELD_NAME), None)
    if idx is None:
        raise SystemExit(f"Camp «{FIELD_NAME}» no trobat a Projectes")

    current = props[idx]
    print(f"PROP ACTUAL : {json.dumps(current, ensure_ascii=False)}")
    print(f"PROP NOU    : {json.dumps(VIRTUAL_PROP, ensure_ascii=False)}")

    if current.get("type") == "virtual" and current.get("compute") == "task_progress":
        print("\n✓ Ja és virtual amb compute=task_progress — res a fer (idempotent).")
        return

    if not args.apply:
        print("\n[DRY-RUN] No s'ha escrit res. Torna a executar amb --apply per aplicar.")
        return

    backup = f"{REGISTRY}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(REGISTRY, backup)
    print(f"\nBackup → {backup}")

    props[idx] = VIRTUAL_PROP
    with open(REGISTRY, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False, indent=2)
    print("✓ Registry actualitzat. Reinicia el backend natiu i invalida el page-index cache.")


if __name__ == "__main__":
    main()
