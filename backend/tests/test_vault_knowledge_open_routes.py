"""Routes tested using local doubles only; no provider or configuration jobs."""

from __future__ import annotations

import asyncio
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.routing import APIRoute

from backend.config.validation_runtime import validation_runtime_enabled
from backend.domains.vault.registry.state import RegistryData


@pytest.fixture(autouse=True)
def require_isolation(isolated_validation_runtime: Path) -> None:
    assert isolated_validation_runtime.is_dir() and validation_runtime_enabled()


def test_process_uses_late_action_and_preserves_result_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.knowledge import jobs_routes as jobs
    from backend.services import llm_wiki_actions as actions

    opaque = object()
    result: dict[str, object] = {"job": opaque}
    calls: list[object] = []

    def start(
        resource_id: str, *, source_table_id: str, force: bool, language: str
    ) -> dict[str, object]:
        calls.append((resource_id, source_table_id, force, language))
        return result

    monkeypatch.setattr(actions, "start_source_process", start)
    request = jobs.LlmWikiProcessRequest(item_id="fallback", source_table_id="source", force=True)
    assert asyncio.run(jobs.llm_wiki_process(request)) is result
    assert calls == [("fallback", "source", True, "")]


@pytest.mark.parametrize("error", [400, 409, 503])
def test_action_error_retains_cause_status_and_detail(
    error: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.domains.vault.knowledge import jobs_routes as jobs
    from backend.services import llm_wiki_actions as actions

    failure = actions.LlmWikiActionError(error, "synthetic failure")

    def status(item_id: str, *, source_table_id: str) -> dict[str, object]:
        raise failure

    monkeypatch.setattr(actions, "process_status", status)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(jobs.llm_wiki_status("resource", "source"))
    assert caught.value.status_code == error and caught.value.detail == "synthetic failure"
    assert caught.value.__cause__ is failure


def test_action_cancellation_is_not_translated(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.vault.knowledge import jobs_routes as jobs
    from backend.services import llm_wiki_actions as actions

    async def maintenance(*, semantic: bool) -> dict[str, object]:
        raise asyncio.CancelledError()

    monkeypatch.setattr(actions, "run_maintenance_async", maintenance)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(jobs.llm_wiki_maintenance(False))


def test_dictation_cleans_temp_before_correction(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.domains.vault.knowledge import jobs_routes as jobs
    from backend.services import (
        llm_wiki_assist as assist,
        llm_wiki_suggestions as suggestions,
        transcription,
    )

    suggestion: dict[str, object] = {"id": "proposal"}
    paths: list[Path] = []
    result: dict[str, object] = {"proposed": object()}

    def transcribe(path: str) -> transcription.TranscriptionResult:
        source = Path(path)
        assert source.read_bytes() == b"synthetic audio"
        paths.append(source)
        return {"text": "hello", "language": None, "duration": 1.0, "segments": []}

    def correct(value: dict[str, object], transcript: str) -> dict[str, object]:
        assert value is suggestion and transcript == "hello"
        assert len(paths) == 1 and not paths[0].exists()
        return result

    monkeypatch.setattr(suggestions, "get_suggestion", lambda _id: suggestion)
    monkeypatch.setattr(transcription, "is_available", lambda: True)
    monkeypatch.setattr(transcription, "transcribe", transcribe)
    monkeypatch.setattr(assist, "correct_dictation", correct)
    audio = UploadFile(file=BytesIO(b"synthetic audio"))
    assert asyncio.run(jobs.llm_wiki_dictate("proposal", audio)) is result


def test_config_selection_preserves_sequence_and_opaque_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.knowledge import config_routes as config
    from backend.domains.vault.knowledge.contracts import BrainTableSelectionRequest
    from backend.services import llm_wiki_config as settings, llm_wiki_indices as indices

    opaque = object()
    source: dict[str, object] = {"table_id": "source", "extension": opaque}
    state: dict[str, object] = {"source_tables": [source], "extension": opaque}
    events: list[str] = []

    def table(table_id: object) -> RegistryData:
        events.append("table")
        return {"id": table_id, "name": "Synthetic"}

    def save(value: dict[str, object]) -> dict[str, object]:
        events.append("save")
        assert value is state and source["relation_property_id"] == "relation"
        return value

    def pages(table_id: object, value: dict[str, object]) -> None:
        events.append("pages")
        assert table_id == "brain" and value is state and value["extension"] is opaque

    monkeypatch.setattr(facade, "_table_by_id", table)
    monkeypatch.setattr(facade, "_ensure_default_db_group", lambda: events.append("group"))
    monkeypatch.setattr(facade, "ensure_brain_table_schema", lambda *_args: 3)
    monkeypatch.setattr(facade, "_infer_brain_roles", lambda _table: {})
    monkeypatch.setattr(facade, "ensure_brain_source_relation", lambda *_args: "relation")
    monkeypatch.setattr(settings, "migrate_config", lambda: state)
    monkeypatch.setattr(settings, "set_full_config", save)
    monkeypatch.setattr(indices, "ensure_system_pages", pages)
    response = asyncio.run(config.set_brain_table(BrainTableSelectionRequest(table_id=" brain ")))
    assert response == {
        "table_id": "brain",
        "configured": True,
        "name": "Synthetic",
        "columns_added": 3,
    }
    assert events == ["table", "group", "table", "save", "pages", "table"]


def test_models_and_routes_keep_module_identity_and_open_fields() -> None:
    from backend.api import vault_routes as facade
    from backend.domains.vault.knowledge import jobs_routes as jobs

    opaque = object()
    model = jobs.LlmWikiJobResponse(index_report={"extension": opaque})
    assert model.index_report is not None and model.index_report["extension"] is opaque
    assert jobs.LlmWikiJobResponse.__module__ == "backend.domains.vault.knowledge.jobs_routes"
    routes = [
        route
        for route in facade.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__module__ == jobs.__name__
    ]
    assert len(routes) == 12
    assert [route.path for route in routes][:3] == [
        "/llm-wiki/process",
        "/llm-wiki/status/{item_id}",
        "/llm-wiki/evidence/{resource_id}/{snapshot_id}/{segment_id}",
    ]
    assert routes[0].response_model is jobs.LlmWikiProcessStartResponse
    assert routes[0].response_model_exclude_unset
