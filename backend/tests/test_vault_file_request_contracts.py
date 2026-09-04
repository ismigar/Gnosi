"""Focused compatibility checks for named Vault file request bodies."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.files import api as files_api
from backend.domains.vault.files.request_contracts import (
    LinkedExistingFileRequest,
    LocalFileRegistrationRequest,
    PhysicalFileDeletionRequest,
    VaultFileRequest,
)


@pytest.mark.parametrize(
    ("model", "payload", "properties"),
    [
        (
            LocalFileRegistrationRequest,
            {"file_path": ["legacy", None]},
            {"file_path"},
        ),
        (
            LinkedExistingFileRequest,
            {"file_path": {"legacy": True}, "target_name": 17},
            {"file_path", "target_name"},
        ),
        (
            PhysicalFileDeletionRequest,
            {"target": False},
            {"target"},
        ),
    ],
)
def test_request_models_preserve_malformed_and_extension_values(
    model: type[VaultFileRequest],
    payload: dict[str, object],
    properties: set[str],
) -> None:
    extension = {"future_extension": {"nested": [1, "two", None]}}
    parsed = model.model_validate({**payload, **extension})

    assert parsed.as_payload() == {**payload, **extension}
    schema = model.model_json_schema()
    assert schema["type"] == "object"
    assert set(schema["properties"]) == properties


@pytest.mark.parametrize(
    ("path", "model"),
    [
        ("/local-file/register", LocalFileRegistrationRequest),
        ("/link-existing-file", LinkedExistingFileRequest),
        ("/delete-physical-file", PhysicalFileDeletionRequest),
    ],
)
def test_routes_expose_named_request_models(
    path: str,
    model: type[VaultFileRequest],
) -> None:
    route = next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.path == path
    )

    assert route.body_field is not None
    assert route.body_field.field_info.annotation is model


def test_registration_handoff_preserves_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload: dict[str, object] = {"file_path": ["legacy"], "extension": 1}
    captured: dict[str, object] = {}

    async def fake_service(body: dict[str, object], dependencies: object) -> dict[str, str]:
        assert dependencies is files_api._deps().local_files
        captured.update(body)
        return {"status": "ok"}

    monkeypatch.setattr(files_api.local_service, "register_local_file", fake_service)

    result = asyncio.run(
        files_api.register_local_file(LocalFileRegistrationRequest.model_validate(payload))
    )

    assert result == {"status": "ok"}
    assert captured == payload


def test_link_handoff_preserves_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    payload: dict[str, object] = {
        "file_path": None,
        "target_name": {"raw": True},
        "extension": 2,
    }
    captured: dict[str, object] = {}

    async def fake_service(body: dict[str, object], dependencies: object) -> dict[str, str]:
        assert dependencies is files_api._deps().link_files
        captured.update(body)
        return {"status": "ok"}

    monkeypatch.setattr(files_api.local_service, "link_existing_file", fake_service)

    result = asyncio.run(
        files_api.link_existing_file(LinkedExistingFileRequest.model_validate(payload))
    )

    assert result == {"status": "ok"}
    assert captured == payload


def test_delete_handoff_preserves_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    payload: dict[str, object] = {"target": ["raw"], "extension": 3}
    captured: dict[str, object] = {}

    async def fake_service(body: dict[str, object], dependencies: object) -> dict[str, str]:
        assert dependencies is files_api._deps().delete_files
        captured.update(body)
        return {"status": "ok"}

    monkeypatch.setattr(files_api.local_service, "delete_physical_file", fake_service)

    result = asyncio.run(
        files_api.delete_physical_file(PhysicalFileDeletionRequest.model_validate(payload))
    )

    assert result == {"status": "ok"}
    assert captured == payload
