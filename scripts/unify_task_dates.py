#!/usr/bin/env python3
"""Preview or apply the explicit, backed-up Data/Període migration for one table.

No automatic startup migration. Applying requires an unchanged preview and
records verified original bytes outside the vault before the first write.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tarfile
from pathlib import Path
from typing import Any

import yaml

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.services.unified_dates import merge_dates, remap_date_references, remap_scoped_date_references


def frontmatter(raw: str) -> tuple[dict[str, Any], str]:
    if not raw.startswith("---\n"):
        return {}, raw
    header, separator, body = raw[4:].partition("\n---\n")
    if not separator:
        raise ValueError("Malformed Markdown frontmatter")
    meta = yaml.safe_load(header)
    if not isinstance(meta, dict):
        raise ValueError("Frontmatter must be an object")
    return meta, body


def serialize(meta: dict[str, Any], body: str) -> bytes:
    return ("---\n" + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).rstrip()
            + "\n---\n" + body).encode("utf-8")


def plan_migration(vault: Path, table_name: str = "Tasques") -> tuple[dict[str, bytes], dict[str, Any]]:
    registry_path = vault / "BD/vault_db_registry.json"
    registry = json.loads(registry_path.read_text())
    candidates = [table for table in registry.get("tables", []) if table.get("name") == table_name]
    if len(candidates) != 1:
        raise ValueError("Expected exactly one task table")
    table = candidates[0]
    props = table["properties"]
    data = next(prop for prop in props if prop["name"] == "Data")
    period = next((prop for prop in props if prop["name"] == "Període"), None)
    if period is None:
        return {}, {"already_migrated": True, "table_id": table["id"]}
    date_keys = [data["id"], "Data"]
    period_keys = [period["id"], "Període"]
    replacements = {"Període": "Data", period["id"]: data["id"]}
    changes: dict[str, bytes] = {}
    counts = {"point": 0, "period": 0, "empty": 0, "conflicts": 0, "records": 0}
    # Table views and inline section configurations live in the registry; task
    # bodies must not trigger downloads of unrelated cloud-backed content.
    folder = vault / "BD" / table["folder"]
    for path in folder.rglob("*.md"):
        if any(part in {".gnosi", ".history", ".trash"} for part in path.relative_to(vault).parts):
            continue
        original = path.read_bytes()
        meta, body = frontmatter(original.decode("utf-8"))
        updated = remap_scoped_date_references(meta, table["id"], replacements)
        is_task = (meta.get("table_id") or meta.get("database_table_id")) == table["id"]
        # Imported records may inherit table identity through their registered folder.
        is_task = is_task or path.is_relative_to(folder)
        if is_task:
            counts["records"] += 1
            old_data = next((meta[key] for key in date_keys if meta.get(key) not in (None, "")), None)
            old_period = next((meta[key] for key in period_keys if meta.get(key) not in (None, "")), None)
            date = merge_dates(old_data, old_period, period_with_time=period.get("period_unit") == "hours")
            sources = {key: meta[key] for key in date_keys + period_keys if meta.get(key) not in (None, "")}
            # Duplicate ID/name keys can disagree in an imported record. They
            # remain available in the value, beyond the external byte backup.
            for keys in (date_keys, period_keys):
                alternatives = [meta[key] for key in keys if meta.get(key) not in (None, "")]
                if date is not None and len(alternatives) > 1 and alternatives[0] != alternatives[1]:
                    date["legacyValues"] = sources
            for key in date_keys + period_keys:
                updated.pop(key, None)
            # Keep the existing storage convention to avoid duplicate stale keys.
            target = data["id"] if data["id"] in meta else "Data"
            if date is not None:
                updated[target] = date
                counts[date["kind"]] += 1
                counts["conflicts"] += int("legacyValues" in date)
            else:
                counts["empty"] += 1
            for key in period_keys:
                rrule = meta.get(key + "_rrule")
                if rrule:
                    target_rule = target + "_rrule"
                    if updated.get(target_rule) not in (None, "", rrule):
                        raise ValueError("Conflicting recurrence rules; review before migration")
                    updated[target_rule] = rrule
                    updated.pop(key + "_rrule", None)
        if updated != meta:
            new_raw = serialize(updated, body)
            assert frontmatter(new_raw.decode("utf-8"))[1] == body
            changes[str(path.relative_to(vault))] = new_raw
    # Changes in unrelated table references (e.g. rollups) are intentionally scoped
    # to the immutable field ID, while task views also support their historical names.
    for view in registry.get("views", []):
        rewritten = remap_date_references(view, replacements if view.get("table_id") == table["id"]
                                          else {period["id"]: data["id"]})
        if view.get("table_id") == table["id"]:
            widths = rewritten.setdefault("columnWidths", {})
            widths["Data"] = max(320, widths.get("Data", 0))
        view.clear()
        view.update(rewritten)
    for current in registry.get("tables", []):
        mapping = replacements if current["id"] == table["id"] else {period["id"]: data["id"]}
        current["properties"] = remap_date_references(current["properties"], mapping)
    data = next(prop for prop in table["properties"] if prop["name"] == "Data")
    for key in ("duration_enabled", "predecessors_enabled", "skip_non_working_days", "period_unit"):
        if key in period:
            data[key] = period[key]
    data["type"] = "date"
    data["config"] = {**period.get("config", {}), **data.get("config", {}),
                      "aliases": list(dict.fromkeys([*data.get("config", {}).get("aliases", []), *period_keys]))}
    table["properties"] = [prop for prop in table["properties"] if prop["id"] != period["id"]]
    table["schema_revision"] = int(table.get("schema_revision", 0)) + 1
    changes["BD/vault_db_registry.json"] = (json.dumps(registry, ensure_ascii=False, indent=2) + "\n").encode()
    hashes = {name: hashlib.sha256((vault / name).read_bytes()).hexdigest() for name in changes}
    report = {"table_id": table["id"], "field_id": data["id"], **counts,
              "files": len(changes), "before_sha256": hashes}
    return changes, report


def apply_migration(vault: Path, changes: dict[str, bytes], report: dict[str, Any], backup: Path) -> None:
    """Compare all sources, verify backup bytes, then write atomically with rollback."""
    originals = {name: (vault / name).read_bytes() for name in changes}
    assert all(hashlib.sha256(raw).hexdigest() == report["before_sha256"][name]
               for name, raw in originals.items()), "Vault changed after preview"
    backup.parent.mkdir(parents=True, exist_ok=True)
    if backup.exists():
        raise ValueError("Backup destination already exists")
    with tarfile.open(backup, "w:gz") as archive:
        for name in changes:
            archive.add(vault / name, arcname=name)
    with tarfile.open(backup, "r:gz") as archive:
        for name, raw in originals.items():
            handle = archive.extractfile(name)
            assert handle is not None and handle.read() == raw, "Backup verification failed"
    written: list[str] = []
    def replace(name: str, raw: bytes) -> None:
        path = vault / name
        temp = path.with_name(path.name + ".unified-date.tmp")
        try:
            temp.write_bytes(raw)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
    try:
        for name, raw in changes.items():
            assert (vault / name).read_bytes() == originals[name], "Concurrent vault change"
            replace(name, raw)
            written.append(name)
            assert (vault / name).read_bytes() == raw
    except BaseException:
        for name in reversed(written):
            replace(name, originals[name])
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vault", type=Path)
    parser.add_argument("--table", default="Tasques")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    changes, report = plan_migration(args.vault, args.table)
    if args.apply and changes:
        if args.backup is None:
            parser.error("--apply requires --backup")
        apply_migration(args.vault, changes, report, args.backup)
        report["applied"] = True
        report["backup"] = str(args.backup)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "before_sha256"}))


if __name__ == "__main__":
    main()
