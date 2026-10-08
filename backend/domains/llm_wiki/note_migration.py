"""Preview, classify, apply or roll back the explicit Brain note-field migration.

No command starts a source-processing job. Preview never invokes a provider or
writes to the vault; classification writes only its resumable output directory.
"""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from backend.domains.llm_wiki import classification_repair
from backend.domains.llm_wiki import migration_files as files
from backend.domains.llm_wiki.field_catalogs import catalog_value
from backend.domains.llm_wiki.field_retirement import (
    MIGRATION_VERSION,
    prune_references,
    retire_schema,
    retired_properties,
)
from backend.domains.llm_wiki.idea_classification import (
    CLASSIFICATION_VERSION,
    classification_property,
    provenance,
)
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.tables.catalogs.core import get_prop_options
from backend.domains.vault.tables.catalogs.roles import ROLE_STATUS, find_role_prop
from backend.domains.vault.tables.catalogs.seeds import STATUS_DRAFT
from backend.services.table_system_dates import stamp_system_dates
from backend.utils.open_values import iterable_values
from backend.utils.safe_io import safe_write_json


def _tables(registry: dict[str, object]) -> list[dict[str, object]]:
    return [
        files.string_record(t)
        for t in iterable_values(registry.get("tables") or [])
        if is_record(t)
    ]


def _registry(value: dict[str, object]) -> RegistryData:
    return {key: item for key, item in value.items()}


def _folder(vault: Path, registry: dict[str, object], table: dict[str, object]) -> Path:
    database = next(
        (
            d
            for d in iterable_values(registry.get("databases") or [])
            if is_record(d) and d.get("id") == table.get("database_id")
        ),
        {},
    )
    assert is_record(database)
    folder = (
        vault
        / str(database.get("folder") or "BD")
        / str(table.get("folder") or table.get("name") or "")
    ).resolve()
    if (
        not folder.is_relative_to(vault.resolve())
        or folder == vault.resolve()
        or not folder.is_dir()
    ):
        raise ValueError("Cannot resolve the Brain's existing table folder safely")
    return folder


def _field_value(metadata: RegistryData, prop: RegistryData) -> object:
    for key in (prop.get("name"), prop.get("id"), *iterable_values(prop.get("aliases") or [])):
        if key and metadata.get(str(key)) not in (None, "", []):
            return metadata[str(key)]
    return None


def inventory(vault: Path) -> dict[str, object]:
    config_path = vault / ".gnosi/llm_wiki.json"
    registry_path = vault / "BD/vault_db_registry.json"
    config, registry = files.read_json(config_path), files.read_json(registry_path)
    table = next(t for t in _tables(registry) if t.get("id") == config.get("brain_table_id"))
    idea = classification_property(table, config)
    if not idea:
        raise ValueError("The Brain has no bound idea-type property")
    rows: list[dict[str, object]] = []
    notes: list[dict[str, object]] = []
    resources: Counter[str] = Counter()
    for path in sorted(_folder(vault, registry, table).rglob("*.md")):
        text = files.read_markdown(path)
        metadata, body = files.frontmatter(text)
        if metadata.get("table_id") != table.get("id"):
            continue
        identifier = str(metadata.get("id") or "")
        if not identifier:
            raise ValueError("A Brain page has no stable identity")
        sidecar = vault / ".gnosi/llm_wiki/pages" / f"{identifier}.json"
        state = files.read_json(sidecar).get("metadata") if sidecar.exists() else {}
        state = dict(state) if is_record(state) else {}
        combined: RegistryData = {**metadata, **state}
        row: dict[str, object] = {
            "id": identifier,
            "path": str(path.relative_to(vault)),
            "sha256": files.digest(text.encode()),
            "sidecar_sha256": files.digest(sidecar.read_bytes()) if sidecar.exists() else None,
            "created_fallback": datetime.fromtimestamp(
                getattr(path.stat(), "st_birthtime", 0) or path.stat().st_ctime, timezone.utc
            ).isoformat(),
        }
        rows.append(row)
        if (
            not combined.get("llm_wiki_managed")
            or not combined.get("llm_wiki_resource_id")
            or combined.get("note_type") not in {"reading", "lectura"}
            or metadata.get("is_template")
        ):
            continue
        resource = str(combined["llm_wiki_resource_id"])
        resource_title = str(combined.get("llm_wiki_resource_title") or resource)
        resources[resource_title] += 1
        value = _field_value(metadata, idea)
        baseline = combined.get("llm_wiki_idea_classification")
        if is_record(baseline) and baseline.get("version") == CLASSIFICATION_VERSION:
            action = "already_classified" if value == baseline.get("value") else "manual"
        else:
            action = (
                "classify" if value in (None, "", catalog_value(idea, "concepte")) else "manual"
            )
        note = {
            **row,
            "title": str(metadata.get("title") or ""),
            "body_md": body,
            "resource_id": resource,
            "resource_title": resource_title,
            "source_table_id": str(combined.get("llm_wiki_source_table_id") or ""),
            "current_value": value,
            "action": action,
        }
        notes.append(note)
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("Duplicate Brain page identities; resolve before migration")
    return {
        "version": MIGRATION_VERSION,
        "vault": str(vault.resolve()),
        "config": config,
        "registry": registry,
        "table": table,
        "idea": idea,
        "rows": rows,
        "notes": notes,
        "resources": dict(resources),
        "config_sha256": files.digest(config_path.read_bytes()),
        "registry_sha256": files.digest(registry_path.read_bytes()),
    }


def _rows(data: dict[str, object], key: str) -> list[dict[str, object]]:
    return [
        files.string_record(row) for row in iterable_values(data.get(key) or []) if is_record(row)
    ]


def _record(data: dict[str, object], key: str) -> dict[str, object]:
    value = data[key]
    if not is_record(value):
        raise ValueError(f"Invalid migration {key}")
    return files.string_record(value)


def _check_inventory(vault: Path, data: dict[str, object]) -> None:
    if data.get("version") != MIGRATION_VERSION or data.get("vault") != str(vault.resolve()):
        raise ValueError("Migration preview belongs to another vault or version")
    for relative, key in (
        (".gnosi/llm_wiki.json", "config_sha256"),
        ("BD/vault_db_registry.json", "registry_sha256"),
    ):
        if files.digest((vault / relative).read_bytes()) != data[key]:
            raise ValueError("Brain configuration changed after preview")
    for row in _rows(data, "rows"):
        if files.digest((vault / str(row["path"])).read_bytes()) != row["sha256"]:
            raise ValueError(f"Note changed after preview: {row['id']}")
        side = vault / ".gnosi/llm_wiki/pages" / f"{row['id']}.json"
        actual = files.digest(side.read_bytes()) if side.exists() else None
        if actual != row["sidecar_sha256"]:
            raise ValueError("Managed note state changed after preview")


def _configured_assignment(
    vault: Path, data: dict[str, object], note: dict[str, object]
) -> dict[str, object] | None:
    from backend.domains.llm_wiki.dimensions import (
        DimensionDependencies,
        build_dimension_context,
        canonical_dimension_value,
        dimension_options,
        metadata_property_value,
    )

    config, registry = _record(data, "config"), _record(data, "registry")
    idea_id = str(_record(data, "idea")["id"])
    source = next(
        (s for s in _rows(config, "source_tables") if s.get("table_id") == note["source_table_id"]),
        {},
    )
    raw_mappings = source.get("dimension_mappings")
    mappings = files.string_record(raw_mappings) if is_record(raw_mappings) else {}
    raw_mapping = mappings.get(idea_id)
    mapping = files.string_record(raw_mapping) if is_record(raw_mapping) else {"mode": "ai"}
    mode = str(mapping.get("mode") or "ai")
    if mode == "ai":
        return None
    tables = _tables(registry)
    source_table = next((t for t in tables if t.get("id") == note["source_table_id"]), {})
    original: RegistryData = {}
    if mode == "source" and source_table:
        for path in _folder(vault, registry, source_table).rglob("*.md"):
            metadata, _body = files.frontmatter(files.read_markdown(path))
            if metadata.get("id") == note["resource_id"]:
                original = metadata
                break
    deps = DimensionDependencies(
        table_by_id=lambda ident: next((t for t in tables if t.get("id") == ident), {}),
        pages_for_table=lambda _ident: [],
        canonical_value=canonical_dimension_value,
        dimension_options=dimension_options,
        metadata_value=metadata_property_value,
    )
    mapped, _specs = build_dimension_context(
        config,
        source_table,
        {"assignment_field_ids": [idea_id], "dimension_mappings": {idea_id: mapping}},
        original,
        dependencies=deps,
    )
    return {
        "value": mapped.get(idea_id),
        "reason": f"Explicit {mode} assignment in source configuration.",
        "method": mode,
        "run_ids": [],
    }


def _classify(vault: Path, output: Path, data: dict[str, object]) -> dict[str, object]:
    from backend.services import reading_budget
    from backend.services.agent_execution import generate_result_for

    _check_inventory(vault, data)
    cached_path = output / "classification-cache.json"
    cache = files.read_json(cached_path) if cached_path.exists() else {}
    signature = files.digest(files.json_text(data).encode())
    if cache and cache.get("vault") != str(vault.resolve()):
        raise ValueError("Classification cache belongs to another vault")
    cache.update(inventory_sha256=signature, vault=str(vault.resolve()))
    cache.setdefault("results", {})
    cache.setdefault("budgets", {})
    results, budgets = _record(cache, "results"), _record(cache, "budgets")
    labels = [option["name"] for option in get_prop_options(_registry(_record(data, "idea")))]
    notes = []
    signatures: dict[str, str] = {}
    for note in _rows(data, "notes"):
        if note["action"] != "classify":
            continue
        projection = {k: note[k] for k in ("id", "title", "body_md", "resource_title")}
        configured = _configured_assignment(vault, data, note)
        fingerprint = files.digest(
            files.json_text(
                [CLASSIFICATION_VERSION, projection, sorted(labels), configured]
            ).encode()
        )
        identifier = str(note["id"])
        signatures[identifier] = fingerprint
        cached = results.get(identifier)
        if is_record(cached) and cached.get("input_sha256") == fingerprint:
            continue
        if configured is not None:
            results[identifier] = {**configured, "input_sha256": fingerprint}
        else:
            results.pop(identifier, None)
            notes.append(note)
    cache.update(results=results, budgets=budgets)
    safe_write_json(cached_path, cache, indent=2, ensure_ascii=False)
    resources = sorted({str(n["resource_id"]) for n in notes})
    for resource in resources:
        key = str(budgets.get(resource) or "")
        if not key:
            from backend.services import llm_wiki_storage

            source_id = next(
                str(n["source_table_id"]) for n in notes if n["resource_id"] == resource
            )
            previous = llm_wiki_storage.get_job_status(resource, source_id)
            key = str(previous.get("budget_id") or "")
            if not key:
                key = reading_budget.configure(reading_budget.DEFAULT_LIMIT_USD)
        reading_budget.status(key)  # Resuming never resets or increases a limit.
        budgets[resource] = key
        cache.update(results=results, budgets=budgets)
        safe_write_json(cached_path, cache, indent=2, ensure_ascii=False)
        selected = [n for n in notes if n["resource_id"] == resource]
        projections = [
            {k: n[k] for k in ("id", "title", "body_md", "resource_title")} for n in selected
        ]
        for batch in classification_repair.batches(projections):
            runs: list[str] = []

            def generate(prompt: str, schema: dict[str, object]) -> str:
                run = generate_result_for("knowledge", prompt, output_schema=schema, timeout=180)
                runs.append(run.run_id)
                return run.result

            try:
                with reading_budget.session(key):
                    classified = classification_repair.classify(batch, labels, generate)
            except Exception as error:
                cache.update(
                    results=results,
                    budgets=budgets,
                    error=type(error).__name__ + ": " + str(error)[:500],
                )
                safe_write_json(cached_path, cache, indent=2, ensure_ascii=False)
                raise
            for identifier, result in classified.items():
                results[identifier] = {
                    **result,
                    "run_ids": runs,
                    "input_sha256": signatures[identifier],
                }
            cache.update(results=results, budgets=budgets, error=None)
            safe_write_json(cached_path, cache, indent=2, ensure_ascii=False)
            print(
                json.dumps(
                    {
                        "classified": len(results),
                        "resource": resource,
                        "budget": reading_budget.status(key),
                    }
                ),
                flush=True,
            )
    return cache


def _classification_result(value: object, idea: RegistryData) -> RegistryData:
    if not is_record(value):
        raise ValueError("Invalid cached classification")
    allowed = {option["name"] for option in get_prop_options(idea)}
    if value.get("value") is not None and value.get("value") not in allowed:
        raise ValueError("Cached classification is outside the current catalog")
    if not isinstance(value.get("reason"), str) or not str(value["reason"]).strip():
        raise ValueError("Cached classification has no justification")
    return value


def build_changes(
    vault: Path,
    data: dict[str, object],
    cache: dict[str, object],
    *,
    defer_classification: bool = False,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    _check_inventory(vault, data)
    table, config, registry = (_record(data, k) for k in ("table", "config", "registry"))
    idea = _registry(_record(data, "idea"))
    cleaned_table, cleaned_config, removed = retire_schema(_registry(table), _registry(config))
    identifiers = {str(p["id"]) for p in retired_properties(_registry(table), _registry(config))}
    notes = {str(n["id"]): n for n in _rows(data, "notes")}
    results = _record(cache, "results") if cache else {}
    expected = {ident for ident, n in notes.items() if n["action"] == "classify"}
    if not defer_classification and not expected.issubset(results):
        raise ValueError("Complete classification before applying the migration")
    registry["tables"] = [
        cleaned_table if t.get("id") == table.get("id") else t for t in _tables(registry)
    ]
    changes = []
    for path, payload in (
        (vault / "BD/vault_db_registry.json", registry),
        (vault / ".gnosi/llm_wiki.json", cleaned_config),
    ):
        item = files.change(vault, path, files.json_text(payload))
        if item:
            changes.append(item)
    counts: Counter[str] = Counter()
    status = find_role_prop(cleaned_table, ROLE_STATUS)
    for row in _rows(data, "rows"):
        path = vault / str(row["path"])
        metadata, body = files.frontmatter(files.read_markdown(path))
        original = dict(metadata)
        for name in removed:
            metadata.pop(name, None)
        note = notes.get(str(row["id"]))
        if note:
            if status and _field_value(metadata, status) is None:
                metadata[str(status["name"])] = STATUS_DRAFT
            if note["action"] == "classify" and not defer_classification:
                result = _classification_result(results[str(row["id"])], idea)
                for alias in [idea.get("id"), *iterable_values(idea.get("aliases") or [])]:
                    if alias != idea.get("name"):
                        metadata.pop(alias, None)
                metadata[str(idea["name"])] = result["value"]
                counts["ambiguous" if result["value"] is None else "classified"] += 1
                side = vault / ".gnosi/llm_wiki/pages" / f"{row['id']}.json"
                state = (
                    files.read_json(side)
                    if side.exists()
                    else {
                        "version": 1,
                        "page_id": row["id"],
                        "metadata": {
                            k: v
                            for k, v in original.items()
                            if isinstance(k, str)
                            and (k.startswith("llm_wiki_") or k == "note_type")
                        },
                    }
                )
                managed = _record(state, "metadata")
                managed["llm_wiki_idea_classification"] = {
                    **provenance(
                        str(idea["id"]),
                        result["value"],
                        str(result["reason"]),
                        method=str(result.get("method") or "ai"),
                    ),
                    "run_ids": result.get("run_ids", []),
                }
                state["metadata"] = managed
                item = files.change(vault, side, files.json_text(state))
                if item:
                    changes.append(item)
            else:
                counts[
                    "pending_classification"
                    if note["action"] == "classify"
                    else str(note["action"])
                ] += 1
        # Embedded view definitions also store property IDs in metadata.
        pruned = prune_references(metadata, identifiers, removed - identifiers)
        assert is_record(pruned)
        metadata = dict(pruned)
        if metadata != original:
            stamp_system_dates(
                metadata,
                cleaned_table,
                is_create=False,
                created_fallback=str(row["created_fallback"]),
            )
            item = files.change(vault, path, files.markdown(metadata, body))
            if item:
                changes.append(item)
    report = {
        "version": MIGRATION_VERSION,
        "generated_notes": len(notes),
        "resources": data["resources"],
        "removed_fields": sorted(removed),
        "changed_files": len(changes),
        "counts": dict(counts),
        "bodies_ids_citations_relations_and_creation_dates_preserved": True,
    }
    return changes, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--resource-id", help="Limit preview's reading-note classification to this resource")
    parser.add_argument(
        "--action",
        choices=("preview", "classify", "apply", "retire", "rollback"),
        default="preview",
    )
    args = parser.parse_args()
    if args.resource_id and args.action != "preview":
        raise ValueError("Select the resource when creating the preview; subsequent actions reuse it")
    vault, output = args.vault.resolve(), args.output.resolve()
    if output.is_relative_to(vault):
        raise ValueError("Keep migration backups and reports outside the synced vault")
    output.mkdir(parents=True, exist_ok=True)
    preview_path = output / "preview.json"
    if args.action == "preview":
        data = inventory(vault)
        if args.resource_id:
            selected = [n for n in _rows(data, "notes") if n["resource_id"] == args.resource_id]
            if not selected:
                raise ValueError("The selected resource has no generated reading notes")
            data.update(
                notes=selected,
                resources=dict(Counter(str(n["resource_title"]) for n in selected)),
                resource_id=args.resource_id,
            )
        safe_write_json(preview_path, data, indent=2, ensure_ascii=False, default=str)
        print(
            json.dumps(
                {
                    "notes": len(_rows(data, "notes")),
                    "resources": data["resources"],
                    "actions": dict(Counter(str(n["action"]) for n in _rows(data, "notes"))),
                },
                ensure_ascii=False,
            )
        )
        return
    data = files.read_json(preview_path)
    if data.get("vault") != str(vault) or data.get("version") != MIGRATION_VERSION:
        raise ValueError("Migration preview belongs to another vault or version")
    if args.action == "classify":
        os.environ.update(
            DIGITAL_BRAIN_VAULT_PATH=str(vault),
            VAULT_HOST_PATH=str(vault),
            GNOSI_DISABLE_SCHEDULER="1",
        )
        with classification_repair.execution_session():
            _classify(vault, output, data)
        return
    plan_path = output / "changes.json"
    if args.action == "rollback":
        files.rollback(vault, output, _rows(files.read_json(plan_path), "changes"))
        return
    if plan_path.exists():
        plan = files.read_json(plan_path)
        if plan.get("mode") != args.action:
            raise ValueError("Use a new output directory for a different migration phase")
        changes, report = _rows(plan, "changes"), _record(plan, "report")
    else:
        cache_path = output / "classification-cache.json"
        changes, report = build_changes(
            vault,
            data,
            files.read_json(cache_path) if cache_path.exists() else {},
            defer_classification=args.action == "retire",
        )
        safe_write_json(
            plan_path,
            {"changes": changes, "report": report, "mode": args.action},
            indent=2,
            ensure_ascii=False,
        )
    journal = files.apply(vault, output, changes)
    safe_write_json(
        output / "result.json",
        {**report, "complete": journal["complete"], "backup": journal["backup"]},
        indent=2,
        ensure_ascii=False,
    )
    print(files.json_text(report))


if __name__ == "__main__":
    main()
