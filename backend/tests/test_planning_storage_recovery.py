"""Planning must recover cloud files without erasing state or append-only history."""

import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.api import planning_routes as routes
from backend.platform.files.on_demand import OnDemandFilesProvider
from backend.services.project_planning import PlanningStorageUnavailable, PlanningStore


def _block_read(monkeypatch, target, error_number):
    original = Path.read_text

    def read(path, *args, **kwargs):
        if path == target:
            raise OSError(error_number, "File unavailable")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read)


@pytest.mark.parametrize("error_number", [11, 35, 13])
@pytest.mark.parametrize("document", ["state", "history"])
def test_unavailable_data_is_never_empty_or_modified(tmp_path, monkeypatch, error_number, document):
    store = PlanningStore(tmp_path)
    store.save(store.load())
    store.append_history({"id": "original", "type": "worklog", "hours": 2})
    target = store.path if document == "state" else store.history_path
    before = target.read_bytes()
    _block_read(monkeypatch, target, error_number)

    with pytest.raises(PlanningStorageUnavailable) as raised:
        (store.load if document == "state" else store.history)()
    assert raised.value.path == target
    assert raised.value.retryable == (error_number in {11, 35})
    if document == "history":
        with pytest.raises(PlanningStorageUnavailable):
            store.append_history({"id": "new", "type": "worklog", "hours": 3})
    assert target.read_bytes() == before


@pytest.mark.parametrize("raw", ["{", "[]", '{"version":99}'])
def test_unrecognized_state_is_not_replaced_with_defaults(tmp_path, raw):
    store = PlanningStore(tmp_path)
    store.path.write_text(raw)
    with pytest.raises(PlanningStorageUnavailable):
        store.load()
    assert store.path.read_text() == raw


def test_http_history_read_recovers_original_records_without_blocking_event_loop(tmp_path, monkeypatch):
    store = PlanningStore(tmp_path)
    original = {"id": "w1", "type": "worklog", "taskId": "task-1", "hours": 2,
                "date": "2026-09-08", "createdAt": "2026-09-08T10:00:00",
                "resourceId": None, "correctionOf": None}
    store.append_history(original)
    before = store.history_path.read_bytes()
    read_text = Path.read_text
    pending = True
    warmups = []

    def read(path, *args, **kwargs):
        if path == store.history_path and pending:
            raise OSError(11, "File unavailable")
        return read_text(path, *args, **kwargs)

    class Provider:
        name = "fileprovider"

        def warmup_status(self, path):
            return None

        def schedule_warmup(self, path):
            # This fails if recovery was accidentally started in the I/O worker.
            warmups.append((path, asyncio.get_running_loop()))

    monkeypatch.setattr(Path, "read_text", read)
    monkeypatch.setattr(routes, "_store", lambda: store)
    monkeypatch.setattr(routes, "get_files_provider", Provider)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_workspace_context] = lambda: None
    with TestClient(app) as client:
        response = client.get("/planning/worklogs")
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "3"
        assert response.json()["detail"]["code"] == "planning_storage_pending"
        assert str(tmp_path) not in response.text
        pending = False
        response = client.get("/planning/worklogs")
        assert response.status_code == 200
        assert response.json()["worklogs"] == [original]
        assert response.json()["actualHoursByTask"] == {"task-1": 2.0}
    assert len(warmups) == 1
    assert store.history_path.read_bytes() == before


def test_baselines_and_mutation_report_unavailable_without_overwriting(tmp_path, monkeypatch):
    store = PlanningStore(tmp_path)
    store.save(store.load())
    store.append_history({"id": "b1", "type": "baseline", "projectId": "p1"})
    before_state = store.path.read_bytes()
    before_history = store.history_path.read_bytes()

    class Provider:
        name = "fileprovider"

        def warmup_status(self, path):
            return "failed"

        def schedule_warmup(self, path):
            pytest.fail("A failed download must not restart on every request")

    monkeypatch.setattr(routes, "_store", lambda: store)
    monkeypatch.setattr(routes, "get_files_provider", Provider)
    _block_read(monkeypatch, store.history_path, 11)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(routes.list_baselines("p1"))
    assert raised.value.status_code == 503
    assert raised.value.detail["code"] == "planning_storage_unavailable"
    assert not raised.value.headers

    _block_read(monkeypatch, store.path, 11)
    with pytest.raises(HTTPException):
        asyncio.run(routes.create_resource(routes.ResourcePayload(name="New resource")))
    assert store.path.read_bytes() == before_state
    assert store.history_path.read_bytes() == before_history


def test_history_jsonl_uses_a_text_reader_for_materialization(tmp_path, monkeypatch):
    monkeypatch.delenv("FILEPROVIDER_WARMUP_OPEN_APP", raising=False)
    provider = OnDemandFilesProvider()
    assert provider._open_app_for(tmp_path / "history.jsonl") == "TextEdit"
