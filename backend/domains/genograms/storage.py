"""Vault adapter and serialized validation around canonical Markdown writes."""
from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import TypeVar

from fastapi import HTTPException
from pydantic import ValidationError

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData
from .contracts import GenogramIssue, GenogramPerson, GenogramRelation, GenogramSetupResponse
from .model import PERSON_OPTIONS, RELATION_OPTIONS, validate_network
from .schema import OPTION_LABELS, field_id, label, make_table, stable_id

# Canonical writes and deletes use the same lock. Reads below deliberately read
# files rather than trusting the page index, which updates after the write.
from .locking import network_lock
Record = TypeVar("Record", GenogramPerson, GenogramRelation)


def records(value: object) -> list[RegistryData]:
    return [v for v in value if is_record(v)] if isinstance(value, list) else []


def network_tables(registry: RegistryData) -> dict[str, RegistryData]:
    result: dict[str, RegistryData] = {}
    for table in records(registry.get("tables")):
        for kind in ("people", "relations"):
            if table.get("genogram_kind") == kind or table.get("id") == stable_id(kind):
                result[kind] = table
    return result


def field_names(table: RegistryData, kind: str) -> dict[str, str]:
    model = GenogramPerson if kind == "people" else GenogramRelation
    props = {str(p.get("id")): p for p in records(table.get("properties"))}
    return {role: str(props[field_id(kind, role)]["name"]) for role in model.model_fields if field_id(kind, role) in props}


def reference(value: object) -> str:
    if isinstance(value, list):
        return reference(value[0]) if value else ""
    if isinstance(value, Mapping):
        return reference(value.get("id") or value.get("value"))
    text = str(value or "").strip()
    if text.startswith("[[") and text.endswith("]]" ):
        text = text[2:-2].split("|", 1)[0]
    return text


def normalize(metadata: RegistryData, table: RegistryData, kind: str, model: type[Record], etag: str = "") -> Record:
    from backend.services.field_resolver import get_meta_value
    data: dict[str, object] = {"id": str(metadata.get("id") or ""), "title": str(metadata.get("title") or ""), "etag": etag}
    for role in field_names(table, kind):
        if role == "title":
            continue
        value = get_meta_value(metadata, table, field_id(kind, role))
        prop = next((p for p in records(table.get("properties")) if p.get("id") == field_id(kind, role)), {})
        if value is None:
            aliases = prop.get("aliases")
            if isinstance(aliases, list):
                value = next((metadata[alias] for alias in aliases if isinstance(alias, str) and alias in metadata), None)
        if value is None or value == "":
            continue
        codes = (PERSON_OPTIONS if kind == "people" else RELATION_OPTIONS).get(role, ())
        for code in codes:
            if value == code or value in OPTION_LABELS[code].values():
                value = code
                break
        if role in ("source", "target", "union_id"):
            if isinstance(value, list) and len(value) > 1:
                raise ValueError("A relationship endpoint must contain exactly one record")
            value = reference(value)
        elif role in ("sources", "tags"):
            value = [reference(v) for v in value] if isinstance(value, list) else [reference(value)]
        elif role not in ("birth_approximate", "death_approximate", "birth_order", "pregnancy_weeks"):
            value = str(value)
        data[role] = value
    return model.model_validate(data)


def read_network(registry: RegistryData, metadata_by_id: dict[str, RegistryData] | None = None) -> tuple[list[GenogramPerson], list[GenogramRelation], list[GenogramIssue]]:
    from backend.api import vault_routes as vault
    from backend.domains.vault.tables.folders import _table_vault_dir
    people: list[GenogramPerson] = []
    relations: list[GenogramRelation] = []
    issues: list[GenogramIssue] = []
    for kind, table in network_tables(registry).items():
        folder = _table_vault_dir(table, registry)
        if folder is None or not folder.exists():
            continue
        for path in sorted(folder.rglob("*.md")):
            if any(part.startswith(".") for part in path.relative_to(folder).parts) or path.is_symlink():
                continue
            try:
                raw = path.read_text(encoding="utf-8")
                metadata, _ = vault.parse_frontmatter(raw, path)
                if metadata.get("is_template") is True:
                    continue
                if metadata_by_id is not None:
                    from backend.services.field_resolver import expand_metadata_for_response
                    metadata_by_id[str(metadata.get("id") or "")] = expand_metadata_for_response(metadata, table)
                etag = vault.file_etag(path) or ""
                if kind == "people":
                    people.append(normalize(metadata, table, kind, GenogramPerson, etag))
                else:
                    relations.append(normalize(metadata, table, kind, GenogramRelation, etag))
            except (OSError, ValueError, ValidationError):
                issues.append(GenogramIssue(code="unreadable_record", record_id=path.stem))
    return people, relations, issues


def setup(locale: str) -> GenogramSetupResponse:
    from backend.api import vault_routes as vault
    from backend.domains.vault.tables.routes import _create_table_locked
    from backend.domains.vault.registry.runtime import registry_mutation
    with network_lock(), registry_mutation():
        registry = vault.load_registry()
        databases = records(registry.get("databases"))
        if not any(db.get("id") == stable_id("database") for db in databases):
            databases.append({"id": stable_id("database"), "name": label("database", locale), "folder": "genograms"})
            registry["databases"] = databases
            vault.save_registry(registry)
        for kind in ("people", "relations"):
            if kind not in network_tables(vault.load_registry()):
                _create_table_locked(make_table(kind, locale))
        registry = vault.load_registry()
        for kind, table in network_tables(registry).items():
            props = records(table.get("properties"))
            existing_fields = {prop.get("id") for prop in props}
            props.extend(prop for prop in records(make_table(kind, locale).get("properties")) if prop.get("id") not in existing_fields)
            table["properties"] = props
        vault.save_registry(registry)
        views = records(registry.get("views"))
        if not any(view.get("id") == stable_id("view") for view in views):
            views.append({"id": stable_id("view"), "name": label("view", locale), "table_id": stable_id("people"), "type": "genogram", "genogram": {"version": 1}})
            registry["views"] = views
            vault.save_registry(registry)
        return identity(registry)


def identity(registry: RegistryData) -> GenogramSetupResponse:
    tables = network_tables(registry)
    if len(tables) != 2:
        raise HTTPException(409, detail={"code": "genograms_setup_required"})
    return GenogramSetupResponse(database_id=str(tables["people"]["database_id"]), people_table_id=str(tables["people"]["id"]), relations_table_id=str(tables["relations"]["id"]), view_id=stable_id("view"))


def reject_new_errors(before: list[GenogramIssue], after: list[GenogramIssue]) -> None:
    previous = {(i.code, i.record_id, i.field) for i in before}
    errors = [i for i in after if i.severity == "error" and i.code != "incomplete_relation" and (i.code, i.record_id, i.field) not in previous]
    if errors:
        raise HTTPException(422, detail={"code": "genogram_validation", "message": "Invalid genogram changes: " + ", ".join(sorted({i.code.replace("_", " ") for i in errors})), "issues": [i.model_dump() for i in errors]})


@contextmanager
def write_guard(path: Path, metadata: RegistryData | None) -> Iterator[None]:
    from backend.api import vault_routes as vault
    # Table IDs provide a cheap path for every ordinary Vault write.
    if metadata and metadata.get("is_template") is True:
        yield
        return
    table_id = str((metadata or {}).get("table_id") or (metadata or {}).get("database_table_id") or "")
    old: RegistryData = {}
    if path.exists():
        old, _ = vault.parse_frontmatter(path.read_text(encoding="utf-8"), path)
        if metadata is None:
            table_id = str(old.get("table_id") or old.get("database_table_id") or "")
    old_table_id = str(old.get("table_id") or old.get("database_table_id") or "")
    if old_table_id in (stable_id("people"), stable_id("relations")) and metadata is not None and (table_id != old_table_id or metadata.get("id") != old.get("id")):
        raise HTTPException(409, detail={"code": "genogram_identity_immutable"})
    if table_id not in (stable_id("people"), stable_id("relations")):
        yield
        return
    with network_lock():
        registry = vault.load_registry()
        tables = network_tables(registry)
        if len(tables) != 2:
            yield
            return
        people, relations, unreadable = read_network(registry)
        if unreadable:
            raise HTTPException(409, detail={"code": "genogram_unreadable", "issues": [i.model_dump() for i in unreadable]})
        existing_id = str((metadata or {}).get("id") or "")
        if metadata is None:
            old, _ = vault.parse_frontmatter(path.read_text(encoding="utf-8"), path)
            existing_id = str(old.get("id") or "")
            references = [r.id for r in relations if existing_id in (r.source, r.target, r.union_id)]
            if references:
                raise HTTPException(409, detail={"code": "genogram_referenced", "message": "This record still has relationships. Resolve them before deleting it.", "relations": references})
        else:
            before = validate_network(people, relations)
            try:
                if table_id == str(tables["people"]["id"]):
                    people = [p for p in people if p.id != existing_id] + [normalize(metadata, tables["people"], "people", GenogramPerson)]
                else:
                    relations = [r for r in relations if r.id != existing_id] + [normalize(metadata, tables["relations"], "relations", GenogramRelation)]
            except (ValidationError, ValueError) as error:
                raise HTTPException(422, detail={"code": "genogram_invalid_record"}) from error
            reject_new_errors(before, validate_network(people, relations))
            # Native table selectors persist option names. Stable option IDs are
            # accepted by the visual editor and normalized back when reading.
            from backend.services.field_resolver import get_meta_value, set_meta_value
            kind = "people" if table_id == str(tables["people"]["id"]) else "relations"
            table = tables[kind]
            for role, codes in (PERSON_OPTIONS if kind == "people" else RELATION_OPTIONS).items():
                prop = next((p for p in records(table.get("properties")) if p.get("id") == field_id(kind, role)), {})
                ref = field_id(kind, role)
                value = get_meta_value(metadata, table, ref)
                if value in (None, ""):
                    value = prop.get("default")
                config = prop.get("config")
                options = records(config.get("options")) if is_record(config) else records(prop.get("options"))
                for code in codes:
                    if value == code or value in OPTION_LABELS[code].values():
                        translated = next((option.get("name") for option in options if option.get("name") in OPTION_LABELS[code].values()), value)
                        set_meta_value(metadata, table, ref, translated)
                        break
        yield
