"""Designated references-table HTTP composition."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.params import Depends as DependsParameter


REFERENCE_SCHEMA: list[tuple[str, str]] = [
    ("Citation Key", "text"),
    ("Title", "text"),
    ("Authors", "text"),
    ("Any", "text"),
    ("Item Type", "select"),
    ("Llibre/Revista", "text"),
    ("Editorial", "text"),
    ("Lloc", "text"),
    ("Volum", "text"),
    ("Número", "text"),
    ("Pàgines", "text"),
    ("Edició", "text"),
    ("DOI", "text"),
    ("ISBN", "text"),
    ("ISSN", "text"),
    ("PMID", "text"),
    ("PMCID", "text"),
    ("arXiv", "text"),
    ("URL", "url"),
    ("Idioma", "text"),
    ("Open Access", "checkbox"),
    ("Literature Sources", "text"),
    ("Literature Work Key", "text"),
]


@dataclass(frozen=True)
class ReferenceApiDependencies:
    resolve_get_table_id: Callable[[], Callable[[], str | None]]
    resolve_primary_table: Callable[[], Callable[[str], dict[str, Any] | None]]
    resolve_table: Callable[[], Callable[[str], dict[str, Any] | None]]
    resolve_ensure_schema: Callable[[], Callable[[str], int]]
    resolve_set_table_id: Callable[[], Callable[[str | None], None]]
    resolve_invalidate_index: Callable[[], Callable[[], None]]
    resolve_create_table: Callable[[], Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]]


def register_routes(
    router: APIRouter,
    *,
    post_dependencies: Sequence[DependsParameter],
    create_dependencies: Sequence[DependsParameter],
    delete_dependencies: Sequence[DependsParameter],
    dependencies: ReferenceApiDependencies,
) -> tuple[Callable[..., object], ...]:
    async def get_reference_table() -> dict[str, object]:
        """Status of the designated references table (for Settings and the frontend's
        gating). GLOBAL designation + table in the Principal → we resolve the name in
        the Principal's registry so that Settings is consistent from any vault."""
        table_id = dependencies.resolve_get_table_id()()
        table = dependencies.resolve_primary_table()(table_id) if table_id else None
        return {
            "table_id": table_id,
            "configured": bool(table_id),
            "name": table.get("name") if table else None,
        }

    async def set_reference_table(
        payload: dict[str, Any] = Body(...),
    ) -> dict[str, object]:
        """Designates an existing table as the references table and guarantees
        its citable schema. The user doesn't need to know anything about 'Citation Key'."""
        table_id = str((payload or {}).get("table_id") or "").strip()
        if not table_id:
            raise HTTPException(status_code=400, detail="table_id is required")
        if not dependencies.resolve_table()(table_id):
            raise HTTPException(status_code=404, detail=f"Table {table_id} not found")
        added = dependencies.resolve_ensure_schema()(table_id)
        dependencies.resolve_set_table_id()(table_id)
        dependencies.resolve_invalidate_index()()
        table = dependencies.resolve_table()(table_id)
        return {
            "table_id": table_id,
            "configured": True,
            "name": table.get("name") if table else None,
            "columns_added": added,
        }

    async def create_reference_table(
        payload: dict[str, Any] = Body(default=None),
    ) -> dict[str, object]:
        """Creates a new, already-citable table and designates it as the references table."""
        name = str((payload or {}).get("name") or "").strip() or "Referències"
        table = {
            "name": name,
            "database_id": "gnosi_vault_db",
            "properties": [
                {"id": str(uuid.uuid4()), "name": field, "type": field_type}
                for field, field_type in REFERENCE_SCHEMA
            ],
        }
        created = await dependencies.resolve_create_table()(table)
        created_id = str(created["id"])
        dependencies.resolve_set_table_id()(created_id)
        dependencies.resolve_invalidate_index()()
        return {
            "table_id": created_id,
            "configured": True,
            "name": created.get("name"),
            "created": True,
        }

    async def clear_reference_table() -> dict[str, object]:
        """Disable references without deleting any table."""
        dependencies.resolve_set_table_id()("")
        dependencies.resolve_invalidate_index()()
        return {"table_id": None, "configured": False}

    router.add_api_route(
        "/reference-table",
        get_reference_table,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/reference-table",
        set_reference_table,
        methods=["POST"],
        dependencies=list(post_dependencies),
        response_model=None,
    )
    router.add_api_route(
        "/reference-table/create",
        create_reference_table,
        methods=["POST"],
        dependencies=list(create_dependencies),
        response_model=None,
    )
    router.add_api_route(
        "/reference-table",
        clear_reference_table,
        methods=["DELETE"],
        dependencies=list(delete_dependencies),
        response_model=None,
    )
    return (
        get_reference_table,
        set_reference_table,
        create_reference_table,
        clear_reference_table,
    )


__all__ = ["REFERENCE_SCHEMA", "ReferenceApiDependencies", "register_routes"]
