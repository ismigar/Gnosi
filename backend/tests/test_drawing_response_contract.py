"""Typed HTTP contracts for Vault drawings and local handwriting recognition."""

from __future__ import annotations

import asyncio
import io
from typing import Any

import pytest
from fastapi import APIRouter, UploadFile
from fastapi.routing import APIRoute

from backend.api import handwriting_routes
from backend.domains.vault.drawings import routes as drawing_routes


def _route(router: APIRouter, method: str, path: str) -> APIRoute:
    return next(
        route
        for route in router.routes
        if isinstance(route, APIRoute)
        and route.path == path
        and method in (route.methods or set())
    )


def test_routes_publish_exact_response_models() -> None:
    drawing_models = {
        ("GET", "/drawings"): list[drawing_routes.DrawingSummaryResponse],
        ("GET", "/drawings/{drawing_id}"): drawing_routes.DrawingDocumentResponse,
        ("PUT", "/drawings/{drawing_id}"): drawing_routes.DrawingSaveResponse,
        ("DELETE", "/drawings/{drawing_id}"): drawing_routes.DrawingDeleteResponse,
    }
    handwriting_models = {
        ("GET", "/api/vault/handwriting/status"):
            handwriting_routes.HandwritingStatusResponse,
        ("POST", "/api/vault/handwriting/warmup"):
            handwriting_routes.HandwritingWarmupResponse,
        ("POST", "/api/vault/handwriting/recognize"):
            handwriting_routes.HandwritingRecognitionResponse,
    }

    for (method, path), response_model in drawing_models.items():
        route = _route(drawing_routes.router, method, path)
        assert route.response_model == response_model
        assert route.status_code is None

    for (method, path), response_model in handwriting_models.items():
        route = _route(handwriting_routes.router, method, path)
        assert route.response_model is response_model
        assert route.status_code is None


def test_drawing_operations_preserve_historical_json_shapes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    listed = [
        {
            "id": "drawing-1",
            "title": "Architecture",
            "last_modified": "2026-08-29T12:00:00",
            "size": 4096,
        }
    ]
    document = {
        "store": {"shape:1": {"typeName": "shape", "type": "draw"}},
        "schema": {"schemaVersion": 2},
    }
    saved = {"status": "success", "id": "drawing-1"}
    deleted = {
        "status": "soft_deleted",
        "id": "drawing-1",
        "deleted_at": "2026-08-29T12:30:00",
        "title": "Architecture",
    }

    async def list_drawings(_dependencies: object) -> list[dict[str, Any]]:
        return listed

    async def get_drawing(_drawing_id: str, _dependencies: object) -> dict[str, Any]:
        return document

    async def save_drawing(*_args: object) -> dict[str, Any]:
        return saved

    async def delete_drawing(*_args: object) -> dict[str, Any]:
        return deleted

    monkeypatch.setattr(drawing_routes._legacy.drawing_service, "list_drawings", list_drawings)
    monkeypatch.setattr(drawing_routes._legacy.drawing_service, "get_drawing", get_drawing)
    monkeypatch.setattr(drawing_routes._legacy.drawing_service, "save_drawing", save_drawing)
    monkeypatch.setattr(drawing_routes._legacy.drawing_service, "delete_drawing", delete_drawing)
    monkeypatch.setattr(
        drawing_routes._legacy,
        "_validate_safe_page_id",
        lambda drawing_id: drawing_id,
    )

    request = drawing_routes._legacy.DrawingSaveRequest(
        title="Architecture",
        data=document,
        metadata={},
    )
    listed_response = asyncio.run(drawing_routes.list_drawings())
    document_response = asyncio.run(drawing_routes.get_drawing("drawing-1"))
    saved_response = asyncio.run(drawing_routes.save_drawing("drawing-1", request))
    deleted_response = asyncio.run(drawing_routes.delete_drawing("drawing-1"))

    assert listed_response == listed
    assert document_response == document
    assert saved_response == saved
    assert deleted_response == deleted
    assert [
        drawing_routes.DrawingSummaryResponse.model_validate(item).model_dump()
        for item in listed_response
    ] == listed
    assert drawing_routes.DrawingDocumentResponse.model_validate(
        document_response
    ).root == document
    assert drawing_routes.DrawingSaveResponse.model_validate(
        saved_response
    ).model_dump() == saved
    assert drawing_routes.DrawingDeleteResponse.model_validate(
        deleted_response
    ).model_dump() == deleted


def test_handwriting_operations_preserve_status_warmup_and_recognition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recognized = {
        "text": "Hola món",
        "raw": "Hola mon",
        "lines": ["Hola mon"],
        "model": "local-trocr",
        "corrected": True,
    }
    monkeypatch.setattr(handwriting_routes.handwriting, "is_available", lambda: True)
    monkeypatch.setattr(handwriting_routes.handwriting, "is_loaded", lambda: True)
    monkeypatch.setattr(handwriting_routes.handwriting, "_model_id", lambda: "local-trocr")
    monkeypatch.setattr(handwriting_routes.handwriting, "warmup", lambda: False)
    monkeypatch.setattr(
        handwriting_routes.handwriting,
        "recognize",
        lambda *_args: recognized,
    )
    upload = UploadFile(filename="ink.png", file=io.BytesIO(b"png"))

    status = asyncio.run(handwriting_routes.handwriting_status())
    warmup = asyncio.run(handwriting_routes.handwriting_warmup())
    recognition = asyncio.run(handwriting_routes.recognize_handwriting(upload))

    assert status == {"available": True, "loaded": True, "model": "local-trocr"}
    assert warmup == {"warming": False, "loaded": True}
    assert recognition == recognized
    assert handwriting_routes.HandwritingStatusResponse.model_validate(
        status
    ).model_dump() == status
    assert handwriting_routes.HandwritingWarmupResponse.model_validate(
        warmup
    ).model_dump() == warmup
    assert handwriting_routes.HandwritingRecognitionResponse.model_validate(
        recognition
    ).model_dump() == recognition
