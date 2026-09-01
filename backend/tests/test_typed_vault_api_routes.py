"""Direct-call contracts for typed multi-Vault and page-view facades."""

from __future__ import annotations

import asyncio
import json
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

from backend.services.workspace_service import WorkspaceContext


class _VaultQuery:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def filter(self, *_conditions: object) -> _VaultQuery:
        return self

    def all(self) -> list[SimpleNamespace]:
        return self.rows


class _VaultDatabase:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def query(self, *_entities: object) -> _VaultQuery:
        return _VaultQuery(self.rows)


def test_list_vaults_keeps_nested_mapping_shape(tmp_path, monkeypatch) -> None:
    from backend.api import vaults_routes

    rows = [
        SimpleNamespace(
            id="vault-1",
            name="Principal",
            slug="principal",
            path_override=str(tmp_path),
        )
    ]
    context = WorkspaceContext("workspace", "user", "owner", tmp_path)
    monkeypatch.setattr(vaults_routes, "_default_vault_path", lambda: tmp_path)
    monkeypatch.setattr(vaults_routes, "_ensure_main_vault", lambda *_args: None)
    monkeypatch.setattr(vaults_routes, "_prune_container_rows", lambda *_args: None)
    monkeypatch.setattr(vaults_routes, "ensure_vault_slugs", lambda *_args: None)
    monkeypatch.setattr(vaults_routes, "get_active_vault_path", lambda: tmp_path)

    result = vaults_routes.list_vaults(ctx=context, db=_VaultDatabase(rows))

    assert result == {
        "vaults": [
            {
                "id": "vault-1",
                "name": "Principal",
                "slug": "principal",
                "path": str(tmp_path),
                "active": True,
            }
        ],
        "active_path": str(tmp_path),
    }
    assert (
        vaults_routes.VaultMutationResponse(
            id="vault-2",
            name="Legacy",
            slug=None,
            path=str(tmp_path / "legacy"),
        ).model_dump()["slug"]
        is None
    )


def test_page_view_routes_keep_mapping_shapes(tmp_path, monkeypatch) -> None:
    from backend.api import vault_views_routes

    registry_path = tmp_path / "BD" / "vault_db_registry.json"
    registry_path.parent.mkdir()
    registry = {
        "tables": [
            {
                "id": "table-1",
                "name": "Table",
                "properties": [{"name": "Relation"}],
            }
        ],
        "pages": {"page-1": {"sections": []}},
    }
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    monkeypatch.setattr(
        vault_views_routes,
        "load_params",
        lambda *, strict_env: SimpleNamespace(paths={"VAULT": tmp_path}),
    )

    listed = asyncio.run(vault_views_routes.get_page_views("page-1"))

    monkeypatch.setattr(
        vault_views_routes,
        "_load_registry",
        lambda _vault_path: (registry, registry_path),
    )
    monkeypatch.setattr(vault_views_routes, "_save_registry", lambda *_args: None)
    monkeypatch.setattr(vault_views_routes, "_registry_mutation", nullcontext)
    monkeypatch.setattr(vault_views_routes, "_page_exists_on_disk", lambda _page_id: True)
    monkeypatch.setattr(vault_views_routes, "_sync_page", lambda *_args: False)
    view = vault_views_routes.ViewSection(
        heading="Related",
        source_table_id="table-1",
        filter=vault_views_routes.ViewFilter(field="Relation", value="this"),
    )

    upserted = asyncio.run(vault_views_routes.upsert_page_view("page-1", view))
    deleted = asyncio.run(vault_views_routes.delete_page_view("page-1", "Related"))

    assert listed == {"page_id": "page-1", "sections": []}
    assert upserted == {
        "ok": True,
        "page_id": "page-1",
        "action": "created",
        "heading": "Related",
        "md_synced": False,
    }
    assert deleted == {
        "ok": True,
        "page_id": "page-1",
        "heading_deleted": "Related",
    }
