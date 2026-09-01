"""Backward-compatible folder schema persistence."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from fastapi import HTTPException

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData


class SchemaWriter(Protocol):
    def __call__(self, path: Path, data: object, *, indent: int) -> None: ...


@dataclass(frozen=True)
class SchemaDependencies:
    vault_root: Callable[[], Path]
    write_json: SchemaWriter
    logger: logging.Logger


def resolve_subpath_within_vault(
    folder: str,
    *segments: str,
    dependencies: SchemaDependencies,
) -> Path:
    """Resolve a subpath and reject traversal outside the active vault."""
    vault_root = dependencies.vault_root().resolve()
    relative = str(folder or "").strip()
    if not relative:
        raise HTTPException(status_code=400, detail="Empty folder")
    try:
        target = (vault_root / relative).joinpath(*segments).resolve()
        target.relative_to(vault_root)
    except (ValueError, OSError) as error:
        raise HTTPException(status_code=400, detail="Invalid folder path") from error
    return target


async def save_schema(
    folder: str,
    schema: RegistryData,
    dependencies: SchemaDependencies,
) -> RegistryData:
    schema_path = resolve_subpath_within_vault(folder, "schema.json", dependencies=dependencies)
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    dependencies.write_json(schema_path, schema, indent=2)
    return {"status": "success"}


async def get_schema(
    folder: str,
    dependencies: SchemaDependencies,
) -> RegistryData:
    schema_path = resolve_subpath_within_vault(folder, "schema.json", dependencies=dependencies)
    if not schema_path.exists():
        return {}
    try:
        raw: object = json.loads(schema_path.read_text(encoding="utf-8"))
        return raw if is_record(raw) else {}
    except (json.JSONDecodeError, OSError) as error:
        dependencies.logger.warning("Schema %s corrupte o no llegible: %s", schema_path, error)
        return {}


__all__ = [
    "SchemaDependencies",
    "get_schema",
    "resolve_subpath_within_vault",
    "save_schema",
]
