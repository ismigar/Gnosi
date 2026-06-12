"""Migració idempotent dels catàlegs d'opcions del registry del Vault.

Aplica el model de la directiva `vault_option_catalogs_action_rules.md` a un
registry existent:

  1. Backup datat del registry al costat de l'original (només amb --apply).
  2. Camps select/multi_select/status SENSE catàleg → deriva les opcions dels
     valors existents a les files (.md de la carpeta de la taula), ordenades
     per freqüència, i les escriu en format ric {name, color, group?}.
  3. Normalitza els catàlegs existents (strings → format ric, ubicació única
     a config.options) — via option_catalogs.normalize_table_options.
  4. Assigna rols semàntics per nom (Idioma → language, Estat → status,
     Tags → tags); el camp amb rol status passa a `type: status` amb els
     grups per defecte.
  5. Seed d'estats segons funcionalitats actives («Esborrany»/«Revisat» base;
     «Traduït» si traduïble; «Publicat a Drupal»/«Publicat a XXSS» si tenen
     el sync/publicació actius) i dels blocs `action_rules` corresponents.
  6. NO toca cap frontmatter (els valors es guarden per nom i no canvien) →
     reversible restaurant el backup del registry.

Ús (dry-run per defecte; NOMÉS escriu amb --apply):

    cd ~/Projectes/monorepo/apps/gnosi
    python3 -m pipeline.scripts.migrate_option_catalogs \\
        --registry "/ruta/al/vault/BD/vault_db_registry.json"
    python3 -m pipeline.scripts.migrate_option_catalogs \\
        --registry "/ruta/al/vault/BD/vault_db_registry.json" --apply

Restriccions (directiva §6): executar-la amb el backend aturat o acabat de
reiniciar després (el registry es cacheja 30 s en memòria), i MAI el mateix
dia que altres migracions massives sobre OneDrive.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from collections import Counter
from pathlib import Path

import yaml

# Permet executar com a script independent (sense `python -m`).
_HERE = Path(__file__).resolve()
_ROOT = _HERE.parents[2]  # .../monorepo/apps/gnosi
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.services import action_rules  # noqa: E402
from backend.services import option_catalogs as oc  # noqa: E402

# Frontmatter regex (mateixa forma que parse_frontmatter, sense dependre del
# backend complet).
_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def read_frontmatter(path: Path) -> dict:
    """Frontmatter YAML d'un .md, o {} si no es pot llegir (online-only…)."""
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception as exc:
        print(f"    [avís] no s'ha pogut llegir {path.name}: {exc}")
        return {}
    match = _FM_RE.match(raw)
    if not match:
        return {}
    try:
        data = yaml.safe_load(match.group(1))
    except Exception as exc:
        print(f"    [avís] frontmatter invàlid a {path.name}: {exc}")
        return {}
    return data if isinstance(data, dict) else {}


def collect_field_values(folder: Path, prop: dict) -> Counter:
    """Recompte de valors d'una property a les files (.md) d'una carpeta."""
    keys = [k for k in [prop.get("id"), prop.get("name")] if k]
    keys.extend(a for a in (prop.get("aliases") or []) if a)
    is_multi = prop.get("type") == "multi_select"
    counts: Counter = Counter()
    if not folder.is_dir():
        return counts
    for md_file in sorted(folder.glob("*.md")):
        metadata = read_frontmatter(md_file)
        for key in keys:
            if key not in metadata:
                continue
            value = metadata[key]
            if value in (None, "", [], {}):
                continue
            if isinstance(value, list):
                values = [str(v).strip() for v in value if str(v).strip()]
            elif is_multi:
                values = [s.strip() for s in str(value).split(",") if s.strip()]
            else:
                values = [str(value).strip()]
            counts.update(v for v in values if v)
            break  # primera clau amb valor mana (id > nom > àlies)
    return counts


def derive_missing_catalogs(table: dict, vault_root: Path) -> list:
    """Pas 2: catàlegs derivats dels valors per als camps que no en tenen."""
    derived = []
    folder = vault_root / str(table.get("folder") or "")
    for prop in table.get("properties") or []:
        if prop.get("type") not in oc.OPTION_TYPES:
            continue
        cfg = oc.get_prop_config(prop)
        if str(cfg.get("catalog_ref") or "").strip():
            continue
        if oc.get_prop_options(prop):
            continue
        counts = collect_field_values(folder, prop)
        if not counts:
            continue
        options = [name for name, _n in counts.most_common()]
        oc.set_prop_options(prop, oc.normalize_options(options))
        derived.append((prop.get("name"), len(options)))
    return derived


def promote_status_type(table: dict) -> bool:
    """Pas 4b: el camp amb rol status (select) passa a `type: status`."""
    prop = oc.find_role_prop(table, oc.ROLE_STATUS)
    if not prop or prop.get("type") == "status":
        return False
    if prop.get("type") != "select":
        return False
    prop["type"] = "status"
    return True


def migrate(registry_path: Path, apply: bool) -> int:
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    vault_root = registry_path.parent.parent  # <vault>/BD/registry.json
    total_changes = 0

    for table in registry.get("tables", []):
        name = table.get("name") or table.get("id")
        report = []

        derived = derive_missing_catalogs(table, vault_root)
        for field_name, n in derived:
            report.append(f"catàleg derivat de valors per a «{field_name}» ({n} opcions)")

        if oc.normalize_table_options(table):
            report.append("catàlegs normalitzats a format ric")
        if oc.assign_roles(table):
            roles = {
                p.get("name"): oc.prop_role(p)
                for p in table.get("properties") or []
                if oc.prop_role(p)
            }
            report.append(f"rols assignats: {roles}")
        if promote_status_type(table):
            report.append("camp d'estat promogut a type=status")
        if oc.ensure_status_seed(table):
            prop = oc.find_role_prop(table, oc.ROLE_STATUS)
            names = [o["name"] for o in oc.get_prop_options(prop)] if prop else []
            report.append(f"seed d'estats garantit: {names}")
        if action_rules.ensure_action_rules(table):
            report.append(f"action_rules seedejades: {sorted((table.get('action_rules') or {}).keys())}")

        if report:
            total_changes += len(report)
            print(f"\n■ {name}")
            for line in report:
                print(f"  - {line}")

    if not total_changes:
        print("\nRes a migrar: el registry ja està al dia (idempotent).")
        return 0

    if not apply:
        print(f"\nDRY-RUN: {total_changes} canvis pendents. Re-executa amb --apply per escriure'ls.")
        return 0

    backup = registry_path.with_name(
        f"{registry_path.stem}.backup-{time.strftime('%Y%m%d-%H%M%S')}{registry_path.suffix}"
    )
    shutil.copy2(registry_path, backup)
    print(f"\nBackup: {backup}")
    tmp = registry_path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    tmp.replace(registry_path)
    print(f"APLICAT: {total_changes} canvis escrits a {registry_path}")
    print("Recorda reiniciar (o esperar 30 s de cache de) gnosi_backend.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--registry",
        required=True,
        help="Ruta al vault_db_registry.json (dins <vault>/BD/)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Escriu els canvis (per defecte només dry-run)",
    )
    args = parser.parse_args()
    registry_path = Path(args.registry).expanduser()
    if not registry_path.is_file():
        print(f"ERROR: no existeix {registry_path}")
        return 1
    return migrate(registry_path, apply=args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
