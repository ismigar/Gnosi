"""Idempotent migration of the Vault registry's option catalogs.

Quoted field, option, and folder labels below are persisted data. @language-example

Applies the model from the `vault_option_catalogs_action_rules.md` directive to an
existing registry:

  1. Dated backup of the registry next to the original (only with --apply).
  2. Incorporates into each select/multi_select/status field's catalog ALL
     values already present in the rows (.md files in the table's real folder,
     under BD/<database name>/<folder>), sorted by frequency — no value is
     lost; cleanup is done afterward from the UI via delete+reassign.
  3. Normalizes existing catalogs (strings → rich format, single location
     in config.options) — via option_catalogs.normalize_table_options.
  4. Assigns semantic roles by name (Idioma → language, Estat → status,
     Tags → tags); the field with the status role switches to `type: status`
     with the default groups.
  5. Seeds statuses based on active features (base "Esborrany"/"Revisat";
     "Traduït" if translatable; "Publicat a Drupal"/"Publicat a XXSS" if
     sync/publishing is active for them) and the corresponding `action_rules`
     blocks.
  6. Does NOT touch any frontmatter (values are stored by name and don't
     change) → reversible by restoring the registry backup.

Usage (dry-run by default; ONLY writes with --apply):

    cd ~/Projectes/Gnosi
    python3 -m pipeline.scripts.migrate_option_catalogs \
        --registry "/path/to/vault/BD/vault_db_registry.json"
    python3 -m pipeline.scripts.migrate_option_catalogs \
        --registry "/path/to/vault/BD/vault_db_registry.json" --apply

Restrictions (directive §6): run it with the backend stopped, or freshly
restarted afterward (the registry is cached in memory for 30 s), and NEVER on
the same day as other bulk migrations over OneDrive.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from collections import Counter
from collections.abc import Hashable
from pathlib import Path
from typing import TypeGuard

import yaml

# Allows running as a standalone script (without `python -m`).
_HERE = Path(__file__).resolve()
_ROOT = _HERE.parents[2]  # .../Gnosi
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.services import action_rules  # noqa: E402
from backend.services import option_catalogs as oc  # noqa: E402

# Frontmatter regex (same form as parse_frontmatter, without depending on the
# full backend).
_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _is_record(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(isinstance(key, str) for key in value)


def _record(value: object, context: str) -> dict[str, object]:
    if not _is_record(value):
        raise ValueError(f"{context} must be an object with text keys; nothing was written")
    return value


def _records(value: object, context: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{context} must be a list of objects; nothing was written")
    return [_record(item, context) for item in value]


def _field_keys(prop: dict[str, object]) -> list[Hashable]:
    aliases = prop.get("aliases") or []
    if not isinstance(aliases, list):
        raise ValueError("Property aliases must be a list; nothing was written")
    keys: list[Hashable] = []
    for key in [prop.get("id"), prop.get("name"), *aliases]:
        if key:
            if not isinstance(key, Hashable):
                raise ValueError("Property lookup keys must be hashable; nothing was written")
            keys.append(key)
    return keys


def _validate_registry(registry: dict[str, object]) -> None:
    """Check traversed structure without copying or discarding opaque fields."""
    _records(registry.get("databases", []), "Registry databases")
    for table in _records(registry.get("tables", []), "Registry tables"):
        for prop in _records(table.get("properties") or [], "Table properties"):
            if not isinstance(prop.get("type"), Hashable):
                raise ValueError("Property type must be hashable; nothing was written")


def read_frontmatter(path: Path) -> dict[object, object]:
    """YAML frontmatter of a .md file, or {} if it can't be read (online-only…)."""
    try:
        raw = path.read_text(encoding="utf-8")
    except Exception as exc:
        print(f"    [warning] could not read {path.name}: {exc}")
        return {}
    match = _FM_RE.match(raw)
    if not match:
        return {}
    try:
        data: object = yaml.safe_load(match.group(1))
    except Exception as exc:
        print(f"    [warning] invalid frontmatter in {path.name}: {exc}")
        return {}
    return dict(data) if isinstance(data, dict) else {}


def collect_field_values(folder: Path, prop: dict[str, object]) -> Counter[str]:
    """Count of values of a property across the rows (.md files) in a folder."""
    keys = _field_keys(prop)
    is_multi = prop.get("type") == "multi_select"
    counts: Counter[str] = Counter()
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
            break  # first key with a value wins (id > name > alias)
    return counts


def resolve_table_folder(
    table: dict[str, object], registry: dict[str, object], vault_root: Path
) -> Path:
    """REAL folder for a table's rows.

    Tables live under ``<vault>/BD/<database name>/<folder>``
    (see _ensure_table_vault_folder in the backend), NOT under ``<vault>/<folder>``.
    It tries by BD name, by BD id, and, as a last legacy resort,
    the vault root. The first version of this script only looked at
    the root → it derived NO value at all (see directive §6 bis).
    
    """
    folder = str(table.get("folder") or "")
    db = next(
        (
            d
            for d in _records(registry.get("databases", []), "Registry databases")
            if str(d.get("id")) == str(table.get("database_id"))
        ),
        None,
    )
    candidates = []
    if db:
        if db.get("name"):
            candidates.append(vault_root / "BD" / str(db["name"]) / folder)
        if db.get("id"):
            candidates.append(vault_root / "BD" / str(db["id"]) / folder)
    candidates.append(vault_root / folder)
    for c in candidates:
        if c.is_dir():
            return c
    return candidates[0] if candidates else vault_root / folder


def merge_values_into_catalogs(
    table: dict[str, object], registry: dict[str, object], vault_root: Path
) -> list[tuple[object, list[str]]]:
    """Step 2: incorporates into the catalog ALL values existing in the rows
    (directive §6: nothing is lost; cleanup is done afterward by the user via
    delete+reassign). Idempotent: only adds the ones that are missing, at the
    end of the catalog and sorted by frequency; it never removes or reorders any."""
    merged: list[tuple[object, list[str]]] = []
    folder = resolve_table_folder(table, registry, vault_root)
    for prop in _records(table.get("properties") or [], "Table properties"):
        if prop.get("type") not in oc.OPTION_TYPES:
            continue
        cfg = oc.get_prop_config(prop)
        if str(cfg.get("catalog_ref") or "").strip():
            continue
        counts = collect_field_values(folder, prop)
        if not counts:
            continue
        existing = oc.get_prop_options(prop)
        have = {o["name"] for o in existing}
        missing = [name for name, _n in counts.most_common() if name not in have]
        if not missing:
            continue
        oc.set_prop_options(
            prop, oc.normalize_options([*existing, *missing])
        )
        merged.append((prop.get("name"), missing))
    return merged


def promote_status_type(table: dict[str, object]) -> bool:
    """Step 4b: the field with the status role (select) becomes `type: status`."""
    prop = oc.find_role_prop(table, oc.ROLE_STATUS)
    if not prop or prop.get("type") == "status":
        return False
    if prop.get("type") != "select":
        return False
    prop["type"] = "status"
    return True


def _migrate_tables(registry: dict[str, object], vault_root: Path) -> int:
    """Plan all changes in memory; leave opaque, unconsumed configs untouched."""
    total_changes = 0

    for table in _records(registry.get("tables", []), "Registry tables"):
        name = table.get("name") or table.get("id")
        report = []

        merged = merge_values_into_catalogs(table, registry, vault_root)
        for field_name, missing in merged:
            shown = ", ".join(missing[:8]) + ("…" if len(missing) > 8 else "")
            report.append(
                f"existing values added to the '{field_name}' catalog ({len(missing)}): {shown}"
            )

        if oc.normalize_table_options(table):
            report.append("catalogs normalized to the rich format")
        if oc.assign_roles(table):
            roles = {
                p.get("name"): oc.prop_role(p)
                for p in _records(table.get("properties") or [], "Table properties")
                if oc.prop_role(p)
            }
            report.append(f"roles assigned: {roles}")
        if promote_status_type(table):
            report.append("status field promoted to type=status")
        if oc.ensure_status_seed(table):
            prop = oc.find_role_prop(table, oc.ROLE_STATUS)
            names = [o["name"] for o in oc.get_prop_options(prop)] if prop else []
            report.append(f"status seed ensured: {names}")
        if action_rules.ensure_action_rules(table):
            rules = _record(table.get("action_rules") or {}, "Table action rules")
            report.append(f"action_rules seeded: {sorted(rules.keys())}")

        if report:
            total_changes += len(report)
            print(f"\n■ {name}")
            for line in report:
                print(f"  - {line}")

    return total_changes


def migrate(registry_path: Path, apply: bool) -> int:
    try:
        raw_registry: object = json.loads(registry_path.read_text(encoding="utf-8"))
        registry = _record(raw_registry, "Registry")
        _validate_registry(registry)
        vault_root = registry_path.parent.parent  # <vault>/BD/registry.json
        # Some legacy backend setters require a mutable config only when they
        # actually change a property. Surface their shape errors before the
        # backup/write phase, without rejecting opaque configs they never use.
        total_changes = _migrate_tables(registry, vault_root)
    except (ValueError, OSError, TypeError, AttributeError) as exc:
        print(f"ERROR: {exc}. Nothing was written.", file=sys.stderr)
        return 1

    if not total_changes:
        print("\nNothing to migrate: the registry is already up to date (idempotent).")
        return 0

    if not apply:
        print(f"\nDRY-RUN: {total_changes} pending changes. Run again with --apply to write them.")
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
    print(f"APPLIED: {total_changes} changes written to {registry_path}")
    print("Remember to restart gnosi_backend (or wait 30 seconds for its cache to expire).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--registry",
        required=True,
        help="Path to vault_db_registry.json (inside <vault>/BD/)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (dry-run by default)",
    )
    args = parser.parse_args()
    registry_path = Path(args.registry).expanduser()
    if not registry_path.is_file():
        print(f"ERROR: {registry_path} does not exist")
        return 1
    return migrate(registry_path, apply=args.apply)


if __name__ == "__main__":
    raise SystemExit(main())
