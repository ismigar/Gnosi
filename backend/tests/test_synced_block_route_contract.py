"""Typed contracts for Vault synced-block HTTP routes."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.pages import sync_routes


def _route(handler_name: str) -> APIRoute:
    return next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == handler_name
    )


def _configure_temp_vault(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(sync_routes._legacy, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(
        sync_routes._legacy,
        "_current_vault_key",
        lambda: str(tmp_path),
    )


def test_synced_block_routes_expose_exact_response_models() -> None:
    get_route = _route("get_synced_block")
    save_route = _route("save_synced_block")
    events_route = _route("synced_events")

    assert get_route.path == "/synced/{sync_id}"
    assert get_route.methods == {"GET"}
    assert get_route.response_model is sync_routes.SyncedBlockResponse
    assert get_route.status_code is None

    assert save_route.path == "/synced/{sync_id}"
    assert save_route.methods == {"PUT"}
    assert save_route.response_model is sync_routes.SyncedBlockSaveResponse
    assert save_route.status_code is None

    assert events_route.path == "/synced-events"
    assert events_route.methods == {"GET"}
    assert events_route.response_model is None
    assert events_route.status_code is None

    assert set(sync_routes.SyncedBlockResponse.model_fields) == {"sync_id", "content"}
    assert set(sync_routes.SyncedBlockSaveResponse.model_fields) == {
        "sync_id",
        "content",
        "saved",
    }


def test_get_synced_block_preserves_empty_and_persisted_shapes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _configure_temp_vault(monkeypatch, tmp_path)

    empty_result = asyncio.run(sync_routes.get_synced_block("shared-block"))
    expected_empty = {"sync_id": "shared-block", "content": ""}
    assert empty_result == expected_empty
    assert (
        sync_routes.SyncedBlockResponse.model_validate(empty_result).model_dump() == expected_empty
    )

    block_path = tmp_path / ".gnosi" / "synced" / "shared-block.md"
    block_path.write_text("Shared content\n", encoding="utf-8")

    persisted_result = asyncio.run(sync_routes.get_synced_block("shared-block"))
    expected_persisted = {
        "sync_id": "shared-block",
        "content": "Shared content\n",
    }
    assert persisted_result == expected_persisted
    assert (
        sync_routes.SyncedBlockResponse.model_validate(persisted_result).model_dump()
        == expected_persisted
    )


def test_save_synced_block_preserves_json_file_and_broadcast_shapes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _configure_temp_vault(monkeypatch, tmp_path)
    broadcasts: list[tuple[str, str]] = []

    def record_broadcast(sync_id: str, vault_key: str) -> None:
        broadcasts.append((sync_id, vault_key))

    monkeypatch.setattr(sync_routes, "_broadcast_synced", record_broadcast)

    result = asyncio.run(
        sync_routes.save_synced_block(
            "shared-block",
            sync_routes.SyncedBlockSave(content="Updated content\n"),
        )
    )
    expected = {
        "sync_id": "shared-block",
        "content": "Updated content\n",
        "saved": True,
    }

    assert result == expected
    assert sync_routes.SyncedBlockSaveResponse.model_validate(result).model_dump() == expected
    assert (tmp_path / ".gnosi" / "synced" / "shared-block.md").read_text(
        encoding="utf-8"
    ) == "Updated content\n"
    assert broadcasts == [("shared-block", str(tmp_path))]
