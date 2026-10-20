"""Durable meeting state, ownership and replay boundaries."""
import asyncio
import json
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from fastapi import Depends, FastAPI

from backend.services import agent_execution as execution, agent_execution_store as store, meeting_notes as notes
from backend.services.agent_execution_models import AgentExecutionSnapshot, ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.services.agent_operation_catalog import skill_id


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    scope = ExecutionScope(user_id="alice", workspace_id="team", role="owner", vault_path=str(tmp_path / "vault"))
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id="personal", profile={"id": "personal"}, skill_ids=[skill_id("meeting")], instructions=[], catalog_revision="1", revision="1")
    monkeypatch.setattr(store, "resolve_data_dir", lambda **kwargs: tmp_path)
    monkeypatch.setattr(execution, "prepare_snapshot", lambda *_: snapshot)
    from backend.services import agent_execution_scope
    monkeypatch.setattr(agent_execution_scope, "revalidate_scope", lambda _: None)
    notes._states.clear()
    yield scope, snapshot, tmp_path
    notes._states.clear()


def make_job(runtime, run_id="job-1", status="running"):
    scope, snapshot, _ = runtime
    parent = execution.create_job_run(snapshot, run_id, "meeting.minutes")
    store.update(scope, run_id, status=status)
    store.work_checkpoint(scope, run_id, "meeting.status", {"running": True, "stage": "summarizing", "progress": 60, "title": "Private meeting", "page_id": None, "error": None})
    return parent


@pytest.mark.parametrize("phase", ["meeting.input", "meeting.status"])
def test_checkpoint_failure_releases_job_reservation(runtime, monkeypatch, phase):
    scope, _, tmp_path = runtime
    audio = tmp_path / "audio.webm"
    audio.write_bytes(b"fixture")
    original = store.work_checkpoint
    def checkpoint(owner, run_id, name, value=None):
        if name == phase and value is not None:
            raise OSError("checkpoint failed")
        return original(owner, run_id, name, value)
    monkeypatch.setattr(store, "work_checkpoint", checkpoint)
    launch = Mock()
    monkeypatch.setattr(notes, "_launch", launch)
    with execution_scope(scope):
        with pytest.raises(OSError, match="checkpoint failed"):
            notes.start_async(str(audio), "Meeting", "online")
        job = store.latest_job(scope, "meeting.minutes")
        assert job.status == "failed"
        assert not notes.get_status()["running"]
        launch.assert_not_called()
        monkeypatch.setattr(store, "work_checkpoint", original)
        assert notes.start_async(str(audio), "Next meeting", "online")
        launch.assert_called_once()


def test_job_context_resets_if_operation_session_cannot_start(runtime, monkeypatch):
    scope, _, tmp_path = runtime
    from contextlib import contextmanager
    @contextmanager
    def denied_session(_):
        raise PermissionError("scope revoked")
        yield
    monkeypatch.setattr(execution, "operation_session", denied_session)
    with execution_scope(scope):
        original_job = notes._job_id.get()
        with pytest.raises(PermissionError, match="scope revoked"):
            notes.process_meeting(str(tmp_path / "unused.webm"), "Meeting", "online")
        assert notes._job_id.get() == original_job
        assert store.latest_job(scope, "meeting.minutes").status == "failed"


def test_status_isolated_by_user_workspace_and_vault(runtime):
    scope, _, _ = runtime
    with execution_scope(scope):
        make_job(runtime)
        assert notes.get_status()["title"] == "Private meeting"
    for changes in ({"user_id": "bob"}, {"workspace_id": "other"}, {"vault_path": "/private/tmp/other"}):
        other = scope.model_copy(update=changes)
        with execution_scope(other):
            assert notes.get_status()["stage"] == "idle"
            assert notes.get_status()["title"] is None
            with pytest.raises(LookupError):
                notes.resume_async("job-1")


def test_stopped_worker_is_reported_as_interrupted_and_resume_requires_transcript(runtime):
    scope, _, _ = runtime
    with execution_scope(scope):
        make_job(runtime)
        with store.connect() as db:
            db.execute("UPDATE agent_runs SET request=json_set(request,'$._worker_instance','previous-process') WHERE run_id='job-1'")
        status = notes.get_status()
        assert status["stage"] == "interrupted" and not status["running"] and not status["can_resume"]
        store.work_checkpoint(scope, "job-1", "meeting.input", {"audio_path": "lost", "title": "Original", "mode": "online"})
        with pytest.raises(ValueError, match="transcript_not_saved"):
            notes.resume_async("job-1")
        store.work_checkpoint(scope, "job-1", "meeting.transcript", {"text": "Original transcript"})
        assert notes.get_status()["can_resume"]


def test_resume_reuses_transcript_minutes_and_original_page_input(runtime, monkeypatch):
    scope, snapshot, tmp_path = runtime
    from backend.services import transcription
    text = "We agree to buy materials before 10 March."
    data = {"summary": [text], "topics": [], "decisions": [text], "tasks": [{"evidence": text, "owner": None, "deadline": "10 March"}], "next_steps": []}
    transcribe = Mock(return_value={"text": text, "language": "en", "duration": 60})
    generate = Mock(return_value=(json.dumps(data), "fixture"))
    monkeypatch.setattr(transcription, "transcribe", transcribe)
    monkeypatch.setattr(execution, "generate_for", generate)
    page = tmp_path / "page.md"
    writes = []
    def save(title, body, metadata):
        if not page.exists():
            page.write_text(body)
            writes.append((title, body, metadata))
            raise RuntimeError("worker stopped after save")
        assert (title, body, metadata) == writes[0]
        return "same-page-id"
    monkeypatch.setattr(notes, "_create_vault_page", save)
    audio = tmp_path / "audio.webm"
    audio.write_bytes(b"fixture")
    with execution_scope(scope):
        parent = make_job(runtime)
        store.work_checkpoint(scope, "job-1", "meeting.input", {"audio_path": str(audio), "audio_hash": __import__('hashlib').sha256(audio.read_bytes()).hexdigest(), "title": "Original", "mode": "online"})
        token = notes._job_id.set("job-1")
        try:
            with execution.operation_session(parent):
                first = notes.process_meeting(str(audio), "Original", "online")
        finally:
            notes._job_id.reset(token)
        assert first["error"] and not audio.exists()
        original = page.read_bytes()
        def launch(saved, run_id, audio_path, title, mode, language=None):
            assert saved.scope == scope and saved.parent_run_id == "job-1"
            token = notes._job_id.set(run_id)
            try:
                with execution.operation_session(saved):
                    assert notes.process_meeting(audio_path, title, mode)["page_id"] == "same-page-id"
            finally:
                notes._job_id.reset(token)
        monkeypatch.setattr(notes, "_launch", launch)
        notes.resume_async("job-1")
        assert notes.get_status()["stage"] == "done"
        assert notes.get_status()["page_id"] == "same-page-id"
        assert page.read_bytes() == original and len(writes) == 1
        transcribe.assert_called_once()
        generate.assert_called_once()
        with pytest.raises(ValueError, match="not_stopped"):
            notes.resume_async("job-1")


def test_cancelled_parent_never_generates_or_writes(runtime, monkeypatch):
    scope, _, tmp_path = runtime
    from backend.services import transcription
    transcribe, generate, save = Mock(), Mock(), Mock()
    monkeypatch.setattr(transcription, "transcribe", transcribe)
    monkeypatch.setattr(execution, "generate_for", generate)
    monkeypatch.setattr(notes, "_create_vault_page", save)
    with execution_scope(scope):
        parent = make_job(runtime)
        store.cancel(scope, "job-1")
        token = notes._job_id.set("job-1")
        try:
            with execution.operation_session(parent):
                assert notes.process_meeting(str(tmp_path / "audio"), "Test", "online")["error"] == "meeting_cancelled"
        finally:
            notes._job_id.reset(token)
        assert store.read(scope, "job-1").status == "cancelled"
        assert not notes.get_status()["running"]
        transcribe.assert_not_called()
        generate.assert_not_called()
        save.assert_not_called()


def test_record_http_viewer_denied_before_audio_is_saved(runtime, monkeypatch):
    from backend.api import meeting_routes
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context
    scope, _, tmp_path = runtime
    viewer = scope.model_copy(update={"role": "viewer"})
    async def bind():
        with execution_scope(viewer):
            yield
    app = FastAPI()
    app.include_router(meeting_routes.router, dependencies=[Depends(bind)])
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext(viewer.workspace_id, viewer.user_id, viewer.role, Path(viewer.vault_path))
    audio_dir = Mock(return_value=tmp_path)
    monkeypatch.setattr(meeting_routes, "_audio_dir", audio_dir)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa") as client:
            result = await client.post('/api/meetings/record', files={"audio": ("meeting.webm", b"audio")})
            assert result.status_code == 403
    asyncio.run(run())
    audio_dir.assert_not_called()


def test_durable_reservation_prevents_duplicate_jobs_but_allows_other_users(runtime):
    scope, snapshot, _ = runtime
    with execution_scope(scope):
        make_job(runtime)
        with pytest.raises(ValueError, match="meeting_already_running"):
            execution.create_job_run(snapshot, "duplicate", "meeting.minutes")
        other = scope.model_copy(update={"user_id": "bob"})
        execution.create_job_run(snapshot.model_copy(update={"scope": other}), "bob-job", "meeting.minutes")
        assert store.latest_job(other, "meeting.minutes").run_id == "bob-job"


def test_audio_engine_tracks_durable_meeting_parent_and_observes_its_cancellation(runtime, monkeypatch):
    from types import SimpleNamespace
    from backend.config import app_config
    from backend.services import agent_specialized_tools, agent_skill_catalog
    from backend.services.agent_operation_catalog import skill_id
    scope, snapshot, _ = runtime
    monkeypatch.setattr(execution, "prepare_snapshot", lambda *_: execution._snapshot.get() or snapshot)
    monkeypatch.setattr(app_config, "load_params", lambda **_: SimpleNamespace(ai={"agents": [snapshot.profile]}))
    monkeypatch.setattr(agent_skill_catalog, "resolve_agent_runtime", lambda *a, **kw: SimpleNamespace(active_skill_ids=[skill_id("meeting")], tool_descriptors=[SimpleNamespace(id="core.transcribe-asset")]))
    invoke = Mock(return_value={"text": "Private transcript"})
    with execution_scope(scope):
        parent = make_job(runtime)
        with execution.operation_session(parent):
            assert agent_specialized_tools.run_engine("transcription", "audio", invoke)["text"] == "Private transcript"
            child = next(run for run in store.list_runs(scope) if run.operation == "transcription")
            assert child.parent_run_id == "job-1" and child.status == "completed"
            store.cancel(scope, "job-1")
            from backend.services.agent_cancellation import AgentTurnCancelled
            with pytest.raises(AgentTurnCancelled):
                agent_specialized_tools.run_engine("transcription", "audio", invoke)
            invoke.assert_called_once()


def test_selected_language_is_saved_and_preserved_on_resume(runtime, monkeypatch):
    scope, _, tmp_path = runtime
    audio = tmp_path / 'audio.webm'
    audio.write_bytes(b'fixture')
    launch = Mock()
    monkeypatch.setattr(notes, '_launch', launch)
    with execution_scope(scope):
        assert notes.start_async(str(audio), 'Original', 'online', 'ca')
        job = store.latest_job(scope, 'meeting.minutes')
        inputs = store.work_checkpoint(scope, job.run_id, 'meeting.input')
        assert inputs['language'] == 'ca'
        assert launch.call_args.args[-1] == 'ca'
        store.update(scope, job.run_id, status='failed', error='interrupted')
        store.work_checkpoint(scope, job.run_id, 'meeting.transcript', {'text': 'Una transcripció desada.'})
        notes.resume_async(job.run_id)
        assert launch.call_args.args[-1] == 'ca'
        assert launch.call_args.args[1] == job.run_id


def test_unsupported_language_cannot_reserve_a_job(runtime, monkeypatch):
    scope, _, tmp_path = runtime
    with execution_scope(scope):
        with pytest.raises(ValueError, match='Unsupported meeting language'):
            notes.start_async(str(tmp_path / 'missing-audio'), 'Test', 'online', 'invalid')
        assert store.latest_job(scope, 'meeting.minutes') is None


def test_original_job_cannot_be_claimed_while_another_owner_job_is_active(runtime):
    scope, snapshot, _ = runtime
    with execution_scope(scope):
        make_job(runtime, status='failed')
        execution.create_job_run(snapshot, 'new-job', 'meeting.minutes')
        with pytest.raises(ValueError, match='meeting_already_running'):
            store.claim_feature_job(scope, 'job-1', 'meeting.minutes')
        assert store.read(scope, 'job-1').status == 'failed'
