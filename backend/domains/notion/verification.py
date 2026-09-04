"""Typed read-only verification of an exact Notion clone."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Callable, Dict, Iterable, List, Optional, Protocol

import yaml

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData

JsonMap = Dict[str, object]


class VerificationClient(Protocol):
    def search_databases(self) -> List[JsonMap]: ...

    def query_database(self, database_id: str) -> Iterable[JsonMap]: ...


@dataclass(frozen=True)
class VerificationDependencies:
    active_vault_path: Callable[[], Optional[Path]]
    client_factory: Callable[[str], VerificationClient]
    clone_table_id: Callable[[str], str]
    load_registry: Callable[[], RegistryData]
    relation_ids: Callable[[object], List[str]]
    relation_keys_from_table: Callable[[RegistryData], set[str]]
    sanitize_folder: Callable[[str], str]
    verify_clone: Callable[[Dict[str, int], List[JsonMap]], JsonMap]


def split_frontmatter(text: str) -> tuple[JsonMap, str]:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            loaded = yaml.safe_load(parts[1])
            metadata = dict(loaded) if isinstance(loaded, dict) else {}
            return metadata, parts[2].lstrip("\n")
    return {}, text


def _notion_counts(
    client: VerificationClient,
    database_ids: List[str],
    clone_table_id: Callable[[str], str],
) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for database_id in database_ids:
        table_id = clone_table_id(database_id)
        try:
            counts[table_id] = sum(1 for _row in client.query_database(database_id))
        except Exception:  # noqa: BLE001
            counts[table_id] = -1
    return counts


def _relation_keys(dependencies: VerificationDependencies) -> Dict[str, set[str]]:
    registry = dependencies.load_registry()
    raw_tables = registry.get("tables")
    tables = raw_tables if isinstance(raw_tables, list) else []
    return {
        str(table.get("id") or ""): dependencies.relation_keys_from_table(table)
        for table in tables
        if is_record(table)
    }


def _page_verification(
    path: Path,
    vault: Path,
    relation_keys_by_table: Dict[str, set[str]],
    relation_ids: Callable[[object], List[str]],
) -> JsonMap:
    metadata, body = split_frontmatter(path.read_text(encoding="utf-8"))
    table_id = str(metadata.get("table_id") or "")
    relations: List[str] = []
    for key in relation_keys_by_table.get(table_id, set()):
        relations.extend(relation_ids(metadata.get(key)))
    assets = [
        value
        for key in ("icon", "cover")
        for value in [metadata.get(key)]
        if isinstance(value, str) and value.startswith("Assets/")
    ]
    assets.extend(re.findall(r"!\[[^\]]*\]\((Assets/[^)\s]+)\)", body))
    missing = [asset for asset in assets if not (vault / asset).exists()]
    return {
        "id": metadata.get("id"),
        "table_id": metadata.get("table_id"),
        "body_empty": not body.strip(),
        "view_count": body.count("gnosi-view:def"),
        "relations": relations,
        "missing_assets": missing,
    }


def run_verification(
    dependencies: VerificationDependencies,
    token: str,
    database_ids: Optional[List[str]],
    target_folder: str = "",
) -> JsonMap:
    """Compare Notion row counts with cloned files without modifying either side."""
    vault = dependencies.active_vault_path()
    if not vault:
        raise RuntimeError("There is no active vault")
    client = dependencies.client_factory(token)
    selected_ids = database_ids or [str(database["id"]) for database in client.search_databases()]
    counts = _notion_counts(client, selected_ids, dependencies.clone_table_id)
    relation_keys_by_table = _relation_keys(dependencies)
    sanitized = dependencies.sanitize_folder(target_folder)
    folder = vault / sanitized if sanitized else vault
    pages: List[JsonMap] = []
    for path in folder.rglob("*.md"):
        try:
            pages.append(
                _page_verification(
                    path,
                    vault,
                    relation_keys_by_table,
                    dependencies.relation_ids,
                )
            )
        except Exception:  # noqa: BLE001
            continue
    return dict(dependencies.verify_clone(counts, pages))
