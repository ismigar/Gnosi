"""Synthetic clipper receipts retain the existing Pydantic validation boundary."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import BackgroundTasks
from pydantic import ValidationError

from backend.api import public_routes, vault_routes
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.models.management import ApiToken
from backend.services import web_clipper
from backend.services.workspace_service import WorkspaceContext
from backend.tests.test_translation_request_validation_contract import assert_equivalent


@pytest.mark.parametrize("receipt", [
    {"status": "clipped", "id": "id", "path": "Folder", "table": "Table"},
    {"status": "clipped", "id": None, "path": "", "table": None},
    {"status": "clipped", "id": b"id", "path": b"Folder", "table": b"Table"},
    {"status": "clipped", "id": 7, "path": [], "table": {}},
    {"status": "clipped", "id": ["id"], "path": None},
    {"status": "clipped", "id": "id", "path": "Folder", "extra": {7: "kept outside"}},
])
def test_receipt_validation_matches_constructor(receipt: dict[str, object]) -> None:
    assert_equivalent(public_routes.PublicClipResponse, receipt)


@pytest.mark.parametrize("folder,expected", [("Custom", "Custom"), (None, "Resources"), ("", "Resources")])
def test_table_clip_uses_real_receipt_and_original_context(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, folder: object, expected: str,
) -> None:
    context = WorkspaceContext("workspace", "user", "editor", tmp_path)
    tasks = BackgroundTasks()
    token = ApiToken(user_id="user", scopes="write")
    opaque = object()
    calls: list[PageSaveRequest] = []
    monkeypatch.setattr(public_routes, "_clipper_state", lambda: (True, {}))
    monkeypatch.setattr(public_routes, "_clipper_target", lambda _cfg: ({"id": "table", "name": "Resources"}, {}))
    monkeypatch.setattr(web_clipper, "build_record", lambda *_args, **_kw: ({"extension": opaque}, "Body"))

    async def create(
        request: PageSaveRequest, background_tasks: BackgroundTasks, received: WorkspaceContext,
    ) -> dict[str, object]:
        assert received is context and background_tasks is tasks
        assert request.metadata["extension"] is opaque
        calls.append(request)
        return {"id": "page", "folder": folder, "extension": opaque}

    monkeypatch.setattr(vault_routes, "create_page", create)
    result = asyncio.run(public_routes.public_clip(
        public_routes.ClipRequest(url="https://example.invalid/synthetic", title="  Example  "),
        tasks, token, context,
    ))
    assert result == {"status": "clipped", "id": "page", "path": expected, "table": "Resources"}
    assert len(calls) == 1 and calls[0].title == "Example" and calls[0].content == "Body"


def test_invalid_table_receipt_is_not_coerced(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(public_routes, "_clipper_state", lambda: (True, {}))
    monkeypatch.setattr(public_routes, "_clipper_target", lambda _cfg: ({"id": "table", "name": "Resources"}, {}))
    monkeypatch.setattr(web_clipper, "build_record", lambda *_args, **_kw: ({}, "Body"))

    async def create(*_args: object) -> dict[str, object]:
        return {"id": ["invalid"], "folder": ["invalid"]}

    monkeypatch.setattr(vault_routes, "create_page", create)
    with pytest.raises(ValidationError) as error:
        asyncio.run(public_routes.public_clip(
            public_routes.ClipRequest(url="https://example.invalid/synthetic"), BackgroundTasks(),
            ApiToken(user_id="user"), WorkspaceContext("workspace", "user", "editor", tmp_path),
        ))
    assert [item["loc"] for item in error.value.errors()] == [("id",), ("path",)]


def test_classic_clip_receipt_omits_unset_table(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[object] = []
    monkeypatch.setattr(public_routes, "_clipper_state", lambda: (True, {}))
    monkeypatch.setattr(public_routes, "_clipper_target", lambda _cfg: (None, None))

    def write(folder: str, title: str, body: str, metadata: dict[str, object]) -> dict[str, str]:
        calls.append((folder, title, body, metadata["tags"]))
        return {"id": "classic", "path": "Clips/Example.md"}

    monkeypatch.setattr(public_routes, "_write_vault_page", write)
    result = asyncio.run(public_routes.public_clip(
        public_routes.ClipRequest(url="https://example.invalid/synthetic", title="Example", content="Body"),
        BackgroundTasks(), ApiToken(user_id="user"), WorkspaceContext("workspace", "user", "editor", tmp_path),
    ))
    assert result == {"status": "clipped", "id": "classic", "path": "Clips/Example.md"}
    assert calls == [("Clips", "Example", "[Font](https://example.invalid/synthetic)\n\nBody", ["clipped"])]
