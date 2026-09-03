"""Focused contracts for the last Vault JSON routes and binary boundaries."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import get_type_hints

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.routing import APIRoute

from backend.config.validation_runtime import validation_runtime_enabled


@pytest.fixture(autouse=True)
def require_isolation(isolated_validation_runtime: Path) -> None:
    assert isolated_validation_runtime.is_dir() and validation_runtime_enabled()


def _routes() -> list[APIRoute]:
    from backend.api import vault_routes

    return [route for route in vault_routes.router.routes if isinstance(route, APIRoute)]


def _route(endpoint_name: str, path: str | None = None) -> APIRoute:
    return next(
        route
        for route in _routes()
        if route.endpoint.__name__ == endpoint_name and (path is None or route.path == path)
    )


def _only_method(route: APIRoute) -> str:
    assert route.methods is not None and len(route.methods) == 1
    return next(iter(route.methods))


def test_remaining_json_routes_publish_precise_response_models() -> None:
    from backend.domains.vault.files.contracts import PhysicalFileDeletionResponse
    from backend.domains.vault.knowledge import jobs_routes
    from backend.domains.vault.media.schemas import (
        NativeFileSelectionResponse,
        NativeFolderSelectionResponse,
    )

    expected: dict[str, object] = {
        "llm_wiki_evidence": jobs_routes.LlmWikiEvidenceResponse,
        "llm_wiki_lint": jobs_routes.LlmWikiLintResponse,
        "llm_wiki_accept_suggestion": jobs_routes.BrainSuggestionReadOnlyErrorResponse,
        "llm_wiki_reformulate": jobs_routes.BrainSuggestionVariantsResponse,
        "llm_wiki_dictate": jobs_routes.BrainDictationResponse,
        "llm_wiki_glossary_learn": jobs_routes.BrainGlossaryResponse,
        "get_albums": list[str],
        "pick_folder": NativeFolderSelectionResponse,
        "pick_file": NativeFileSelectionResponse,
        "delete_physical_file": PhysicalFileDeletionResponse,
    }
    for endpoint_name, response_model in expected.items():
        route = _route(endpoint_name)
        assert route.response_model == response_model
        assert route.status_code is None

    for endpoint_name in (
        "llm_wiki_evidence",
        "llm_wiki_lint",
        "llm_wiki_accept_suggestion",
        "llm_wiki_reformulate",
        "llm_wiki_dictate",
        "llm_wiki_glossary_learn",
    ):
        assert _route(endpoint_name).response_model_exclude_unset is True


def test_response_model_none_is_limited_to_exact_binary_and_streaming_routes() -> None:
    target_modules = {
        "backend.domains.vault.assets.api",
        "backend.domains.vault.files.api",
        "backend.domains.vault.knowledge.jobs_routes",
        "backend.domains.vault.media.routes",
        "backend.domains.vault.pages.sync_routes",
    }
    actual = {
        (_only_method(route), route.path, route.endpoint.__module__, route.endpoint.__name__)
        for route in _routes()
        if route.endpoint.__module__ in target_modules and route.response_model is None
    }
    assert actual == {
        (
            "GET",
            "/assets/{asset_path:path}",
            "backend.domains.vault.assets.api",
            "get_asset",
        ),
        (
            "GET",
            "/images/{image_path:path}",
            "backend.domains.vault.assets.api",
            "serve_vault_image",
        ),
        (
            "GET",
            "/library/{rel_path:path}",
            "backend.domains.vault.files.api",
            "serve_library_file",
        ),
        (
            "GET",
            "/raw/{rel_path:path}",
            "backend.domains.vault.files.api",
            "serve_vault_raw_file",
        ),
        (
            "GET",
            "/thumb/{rel_url:path}",
            "backend.domains.vault.files.api",
            "serve_thumb",
        ),
        (
            "GET",
            "/local-file/{token}/{filename:path}",
            "backend.domains.vault.files.api",
            "serve_local_file",
        ),
        (
            "GET",
            "/local-file/{token}",
            "backend.domains.vault.files.api",
            "serve_local_file",
        ),
        (
            "GET",
            "/synced-events",
            "backend.domains.vault.pages.sync_routes",
            "synced_events",
        ),
    }

    expected_returns = {
        "get_asset": FileResponse,
        "serve_vault_image": FileResponse,
        "serve_library_file": FileResponse,
        "serve_vault_raw_file": FileResponse,
        "serve_thumb": Response,
        "serve_local_file": FileResponse,
        "synced_events": StreamingResponse,
    }
    for route in _routes():
        if route.response_model is None and route.endpoint.__name__ in expected_returns:
            assert (
                get_type_hints(route.endpoint)["return"]
                is expected_returns[route.endpoint.__name__]
            )


def test_new_models_preserve_exact_json_payloads_and_extensions() -> None:
    from backend.domains.vault.files.contracts import PhysicalFileDeletionResponse
    from backend.domains.vault.knowledge import jobs_routes
    from backend.domains.vault.media.schemas import (
        NativeFileSelectionResponse,
        NativeFolderSelectionResponse,
    )

    evidence = {
        "snapshot_id": "snapshot",
        "resource_id": "resource",
        "kind": "pdf",
        "label": "Paper",
        "source_url": None,
        "segment": {
            "id": "segment",
            "order": 2,
            "text": "Evidence",
            "locator": {"page": 4, "future": [True, None]},
            "future_segment_key": {"kept": True},
        },
        "future_evidence_key": [1, "two"],
    }
    assert (
        jobs_routes.LlmWikiEvidenceResponse.model_validate(evidence).model_dump(
            mode="json", exclude_unset=True
        )
        == evidence
    )

    lint = {
        "note_count": 2,
        "orphans": [{"id": "n1", "title": "One"}],
        "stale": [{"id": "n2", "title": "Two", "review": None, "days": None}],
        "missing_xref": [],
        "reprocess": [],
        "duplicate_keys": [],
        "stale_managed": [],
        "broken_cites": [],
        "index_drift": [],
        "counts": {
            "orphans": 1,
            "stale": 1,
            "missing_xref": 0,
            "reprocess": 0,
            "duplicate_keys": 0,
            "stale_managed": 0,
            "broken_cites": 0,
            "index_drift": 0,
        },
        "truncated_missing_xref": False,
        "suggestions_pending": 3,
        "future_lint_key": {"kept": True},
    }
    assert (
        jobs_routes.LlmWikiLintResponse.model_validate(lint).model_dump(
            mode="json", exclude_unset=True
        )
        == lint
    )

    variants = {"variants": [{"label": "Concise", "text": "Draft"}]}
    dictation = {"transcript": "raw", "proposed": "clean", "corrected": True}
    glossary = {"pairs": 7}
    assert (
        jobs_routes.BrainSuggestionVariantsResponse.model_validate(variants).model_dump()
        == variants
    )
    assert jobs_routes.BrainDictationResponse.model_validate(dictation).model_dump() == dictation
    assert jobs_routes.BrainGlossaryResponse.model_validate(glossary).model_dump() == glossary
    assert NativeFolderSelectionResponse.model_validate({"path": "/tmp"}).model_dump() == {
        "path": "/tmp"
    }
    picked_file = {"path": "/tmp/a.pdf", "name": "a.pdf", "size": 4}
    assert NativeFileSelectionResponse.model_validate(picked_file).model_dump() == picked_file
    deleted = {"status": "trashed", "method": "macos_trash", "target": "/tmp/a.pdf"}
    assert PhysicalFileDeletionResponse.model_validate(deleted).model_dump() == deleted


def test_retired_accept_route_keeps_410_runtime_contract() -> None:
    from backend.domains.vault.knowledge import jobs_routes

    with pytest.raises(HTTPException) as caught:
        asyncio.run(jobs_routes.llm_wiki_accept_suggestion("proposal", {}))
    assert caught.value.status_code == 410
    assert caught.value.detail == "Connection proposals cannot create permanent notes"
