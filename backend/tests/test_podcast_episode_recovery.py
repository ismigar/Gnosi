"""Daily Reader episode recovery across real worker death with synthetic source, model and speech."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.services import agent_execution as execution, agent_execution_store as store
from backend.services import audio_summarizer as audio, podcast_briefing, podcast_episode as episodes
from backend.services.agent_execution_models import AgentExecutionSnapshot, AgentOperation, ExecutionScope
from backend.services.agent_execution_scope import current_origin, execution_scope
from backend.utils.metadata_io import MetadataUnavailable


def runtime(patch, root, fault=""):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from backend.models.scheduler import TaskExecutionHistory
    from backend.scheduler import execution as scheduled_execution, manager as scheduler
    from backend.services import agent_execution_scope, workspace_speech

    vault = (root / "vault").resolve()
    data = root / "data"
    scope = ExecutionScope(user_id="fixture-owner", role="owner", workspace_id="private", vault_path=str(vault))
    patch.setattr(store, "resolve_data_dir", lambda **kwargs: data)
    patch.setattr(audio, "_generation_states", {})
    patch.setattr(scheduler, "load_params", lambda **kwargs: SimpleNamespace(paths={
        "SCHEDULER": vault / ".gnosi" / "scheduler_config.json", "VAULT": vault, "LOCAL_DATA": data,
    }))
    engine = create_engine("sqlite:///" + str(data / "fixture-history.sqlite"))
    TaskExecutionHistory.__table__.create(engine, checkfirst=True)
    patch.setattr(scheduled_execution, "get_mgmt_session", lambda: Session(engine))
    patch.setattr(scheduled_execution, "notify", lambda *args, **kwargs: None)
    patch.setattr(agent_execution_scope, "personal_scheduler_scope", lambda: execution_scope(scope, origin="automation"))
    patch.setattr(agent_execution_scope, "revalidate_scope", lambda selected: selected == scope or pytest.fail("scope changed"))
    patch.setattr(audio, "_resolve_podcast_language", lambda: ("ca", "Catalan") if fault else ("fr", "French"))

    def record(event):
        with (root / "observations").open("a") as log:
            log.write(event + "\n")

    def stop(point):
        if fault == point:
            os._exit(86)

    def resolve():
        saved = execution._snapshot.get()
        if saved is None:
            stop("before_parent")
            saved = AgentExecutionSnapshot(scope=scope, origin=current_origin(), agent_id="fixture", profile={},
                skill_ids=["podcast"], instructions=["Synthetic procedure"], behavior_resources={"fixture": "1"},
                catalog_revision="c", revision="frozen")
        return saved, "fixture", "fixture"

    def database():
        from unittest.mock import Mock
        record("query")
        db = Mock()
        db.query.return_value.filter.return_value.all.return_value = [
            SimpleNamespace(id=15, title="Fixture", content="", source=None,
                            full_content="Original text" if fault else "Changed text")
        ]
        yield db

    def script(sources, language, *, snapshot, check_active, **kwargs):
        request = AgentOperation(skill_id="podcast", operation="podcast.segment", input=sources[0]["text"],
                                 output_schema={"type": "object", "required": ["script"]})
        context = SimpleNamespace(snapshot=snapshot, check_active=check_active, cost=lambda request: 1,
                                  budget=1000, _cache_key=lambda request: "fixture-validated-" + request.input)
        result = podcast_briefing._Briefing.stage(context, request, lambda result: None)
        stop("mid_script")
        return result["script"]

    def model(request, *, output_validator, **kwargs):
        record("model " + request.input)
        text = output_validator(json.dumps({"script": "Synthetic narration"}))
        stop("after_model_output")
        return SimpleNamespace(result=text)

    def synthesize(text, cached, language):
        record("speech " + language)
        cached.write_bytes(b"verified synthetic audio")
        stop("after_cache")

    publish = audio._publish_podcast_audio
    def replace(snapshot, staged, target):
        publish(snapshot, staged, target)
        record("publication")
        stop("after_rename")

    patch.setattr(audio, "_resolve_podcast_llm", resolve)
    patch.setattr("backend.data.db.get_db", database)
    patch.setattr(podcast_briefing, "build_podcast_script", script)
    patch.setattr(execution, "run_sync", model)
    patch.setattr(execution, "_operation_context", lambda request, snapshot: (snapshot, {}, None))
    patch.setattr("backend.services.agent_specialized_tools.run_engine", lambda kind, name, callback: callback())
    patch.setattr(workspace_speech, "effective_settings_sync", lambda language: {})
    patch.setattr(workspace_speech, "speech_session", lambda settings: nullcontext())
    patch.setattr(workspace_speech, "fingerprint", lambda text, language: "fixture-cache")
    patch.setattr(audio, "_generate_tts_atomically", synthesize)
    patch.setattr(audio, "_publish_podcast_audio", replace)
    manager = scheduler.SchedulerManager()
    task = manager._tasks["generate_podcast"]
    task.enabled = True
    manager._tasks = {"generate_podcast": task}
    patch.setattr(manager, "_execute_task", lambda name: audio.generate_scheduled_podcast())
    return scope, manager, engine


@pytest.mark.parametrize("fault", ["before_parent", "after_model_output", "mid_script", "after_cache", "after_rename"])
def test_clock_resumes_after_process_death_without_repeating_recorded_work(
    monkeypatch, isolated_validation_runtime, fault,
):
    from sqlalchemy.orm import Session
    from backend.models.scheduler import TaskExecutionHistory
    from backend.scheduler import manager as scheduler
    root = isolated_validation_runtime
    process = subprocess.run([sys.executable, "-m", __name__, str(root), fault],
                             capture_output=True, timeout=45)
    assert process.returncode == 86, process.stderr.decode()[-2000:]
    scope, manager, engine = runtime(monkeypatch, root)
    original = episodes.current(scope.vault_path)
    assert original.status == "running"
    if fault in {"after_cache", "after_rename"}:
        assert len(list((root / "data" / "cache" / "podcasts").rglob("*.mp3"))) == 1
        assert len(list(Path(scope.vault_path).rglob("*.mp3"))) == int(fault == "after_rename")
        speech = store.work_checkpoint(scope, original.run_id, "podcast-speech")
        assert speech["cache_storage"] == "device"
        if fault == "after_cache":
            # The cloud provider can evict an empty output directory between launches.
            output_directory = audio.get_podcast_output_dir(scope.vault_path)
            output_directory.rmdir()
    task = manager._tasks["generate_podcast"]
    assert datetime.now().timestamp() - datetime.fromisoformat(task.last_run).timestamp() < 60
    assert manager._is_due(task, datetime.now())
    # Exercise clock dispatch with the recent persisted last_run, no manual request.
    monkeypatch.setattr(scheduler, "wait_before_automatic_dispatch", lambda event: False)
    manager._running = True
    monkeypatch.setattr(manager._stop_event, "wait", lambda delay: setattr(manager, "_running", False))
    monkeypatch.setattr(manager, "submit_task", lambda name, automatic: manager.run_task_now(name, automatic=automatic))
    manager._run_loop()
    job = store.latest_job(scope, "podcast")
    assert job.status == "completed" and job.run_id == original.run_id
    assert episodes.current(scope.vault_path).public_status()["status"] == "success"
    assert not manager._is_due(task, datetime.now())
    # A later clock tick or a repeated Control Center button preserves this publication.
    assert manager.run_task_now("generate_podcast")["success"]
    with execution_scope(scope):
        assert not audio.start_generation_async()
    lines = (root / "observations").read_text().splitlines()
    assert lines.count("query") == lines.count("publication") == 1
    assert len([line for line in lines if line.startswith("model ")]) == 1
    assert len([line for line in lines if line.startswith("speech ")]) == 1
    if fault != "before_parent":
        assert "model Original text" in lines and "speech ca" in lines
    saved = store.work_checkpoint(scope, job.run_id, "podcast-input")
    assert saved["period_end"] == original.period_end
    mp3s = list(Path(scope.vault_path).rglob("*.mp3"))
    assert len(mp3s) == 1 and mp3s[0].read_bytes() == b"verified synthetic audio"
    with Session(engine) as db:
        history = db.query(TaskExecutionHistory).one()
        assert history.id == original.run_id and history.status == "success"


@pytest.mark.parametrize(("reason", "retry"), [("pending", True), ("offline", True), ("permission", False), ("no_space", False)])
def test_cloud_prerequisite_before_parent_creation_is_durable_safe_and_actionable(
    monkeypatch, isolated_validation_runtime, reason, retry,
):
    from backend.scheduler import task_handlers
    root = isolated_validation_runtime
    scope, manager, _ = runtime(monkeypatch, root)
    vault = Path(scope.vault_path)
    path = vault / "OneDrive - Private Organization" / ".gnosi" / "params.yaml"
    error = MetadataUnavailable("private provider message", reason=reason, path=path)
    def unavailable():
        raise error
    monkeypatch.setattr(manager, "_execute_task",
        lambda name: task_handlers.execute_task(manager, name, unavailable, lambda state, plugin: True))
    first = manager.run_task_now("generate_podcast")
    assert first["status"] == ("waiting" if retry else "error")
    assert not store.latest_job(scope, "podcast")
    previous = episodes.current(vault)
    assert previous.scope is None and previous.worker == {}
    _, restored, _ = runtime(monkeypatch, root)
    assert previous.waiting_file == "params.yaml" and previous.waiting_provider == "OneDrive"
    assert previous.wait_reason == reason
    for caller in (None, scope):
        status = restored.get_task("generate_podcast", caller)
        assert not any(status.get(key) for key in ("waiting_file", "waiting_provider", "wait_reason", "retry_at"))
        assert "Private Organization" not in str(status)
    assert not restored._is_due(restored._tasks["generate_podcast"], datetime.now())
    if retry:
        at = datetime.fromisoformat(previous.retry_at)
        assert at.tzinfo and restored._is_due(restored._tasks["generate_podcast"], at)
    else:
        assert previous.retry_at is None and not restored._is_due(restored._tasks["generate_podcast"],
                                                                  datetime.now() + timedelta(minutes=30))
    # A manual retry after correcting the local prerequisite uses the same occurrence.
    assert restored.run_task_now("generate_podcast")["success"]
    assert store.latest_job(scope, "podcast").run_id == previous.run_id


def test_concurrent_reader_and_scheduler_claim_only_one_parent(monkeypatch, isolated_validation_runtime):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    scope, manager, _ = runtime(monkeypatch, isolated_validation_runtime)
    entered, release = Event(), Event()
    original = audio._generate_daily_podcast
    def blocked():
        entered.set()
        assert release.wait(10)
        return original()
    monkeypatch.setattr(audio, "_generate_daily_podcast", blocked)
    with ThreadPoolExecutor() as workers:
        first = workers.submit(manager.run_task_now, "generate_podcast")
        assert entered.wait(8)
        try:
            with execution_scope(scope):
                assert not audio.start_generation_async()
            assert manager.run_task_now("generate_podcast")["result"]["status"] == "running"
        finally:
            release.set()
        assert first.result(timeout=15)["success"]
    assert (isolated_validation_runtime / "observations").read_text().splitlines().count("publication") == 1


def test_scheduler_and_reader_gets_authorize_the_selected_vault_and_owner(monkeypatch, isolated_validation_runtime):
    from fastapi import APIRouter, Depends, FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session
    from backend.api import scheduler_routes
    from backend.data.management_db import Base, get_mgmt_db
    from backend.domains.reader import podcast_routes
    from backend.models.management import Membership, User, Vault, Workspace
    from backend.models.scheduler import TaskExecutionHistory
    from backend.services import auth_service, workspace_service
    from backend.services.agent_execution_scope import bind_request_scope
    from backend.utils.errors import metadata_unavailable_detail

    root = isolated_validation_runtime
    alice, manager, engine = runtime(monkeypatch, root)
    bob = alice.model_copy(update={"user_id": "bob", "workspace_id": "team-b", "vault_path": str(root / "other")})
    Path(bob.vault_path).mkdir()
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        for scope in (alice, bob):
            db.add(User(id=scope.user_id, email=scope.user_id + "@example.org"))
            db.add(Workspace(id=scope.workspace_id, name=scope.workspace_id))
        db.flush()
        for scope, vault_id in ((alice, "a"), (bob, "b")):
            db.add(Vault(id=vault_id, workspace_id=scope.workspace_id, name=vault_id, path_override=scope.vault_path))
            for user in (alice, bob):
                db.add(Membership(user_id=user.user_id, workspace_id=scope.workspace_id, role="owner"))
        # Same physical directory under a second legitimate workspace must still be private.
        db.add(Vault(id="alias-a", workspace_id=bob.workspace_id, name="Alias", path_override=alice.vault_path))
        db.add(TaskExecutionHistory(task_name="generate_podcast", status="error",
                                    message="Dropbox: bob-private.md is offline"))
        db.commit()

    def database():
        with Session(engine) as db:
            yield db

    def headers(scope, workspace, vault):
        return {"Authorization": "Bearer " + auth_service.create_access_token(scope.user_id),
                "X-Workspace-ID": workspace, "X-Vault-ID": vault, "X-User-ID": alice.user_id}

    params = SimpleNamespace(gnosi_mode="organization", paths={"VAULT": Path(alice.vault_path), "PROJECT_DIR": root})
    monkeypatch.setattr(workspace_service, "load_params", lambda **_: params)
    monkeypatch.setattr("backend.services.vault_warmup.kickoff_critical_warmup", lambda _: None)
    monkeypatch.setattr(auth_service, "SECRET_KEY", "synthetic-test-podcast-access-secret-123456")
    monkeypatch.setattr(scheduler_routes, "scheduler_manager", manager)
    monkeypatch.setattr(audio, "_resolve_podcast_language", lambda: ("en", "English"))
    reader = APIRouter(prefix="/api/reader", dependencies=[Depends(bind_request_scope)])
    podcast_routes.register_routes(reader)
    app = FastAPI()
    app.include_router(scheduler_routes.router)
    app.include_router(reader)
    app.dependency_overrides[get_mgmt_db] = database
    waits = []
    for scope, provider, filename, reason in ((alice, "OneDrive", "alice-private.md", "pending"),
                                              (bob, "Dropbox", "bob-private.md", "offline")):
        episode = episodes.claim(scope.vault_path, source="reader", scope=scope)
        episodes.cloud_failure(episode, MetadataUnavailable(path=Path(scope.vault_path) / provider / filename, reason=reason))
        waits.append(episode)
    with execution_scope(alice):
        snapshot, _, _ = audio._resolve_podcast_llm()
        execution.create_job_run(snapshot, waits[0].run_id, "podcast")
        store.update(alice, waits[0].run_id, status="waiting", error="private parent message")
    keys = ("waiting_file", "waiting_provider", "wait_reason", "retry_at")
    with TestClient(app) as client:
        cases = ((headers(alice, alice.workspace_id, "a"), waits[0]),
                 (headers(bob, bob.workspace_id, "b"), waits[1]),
                 (headers(bob, alice.workspace_id, "a"), None),
                 (headers(alice, bob.workspace_id, "b"), None),
                 (headers(alice, bob.workspace_id, "alias-a"), None))
        for auth, expected in cases:
            for path in ("/api/schedulers", "/api/schedulers/generate_podcast"):
                response = client.get(path, headers=auth)
                assert response.status_code == 200
                task = response.json()[0] if path == "/api/schedulers" else response.json()
                assert task["enabled"] and task["interval_minutes"] == 1440
                assert {key: task[key] for key in keys} == {key: getattr(expected, key, None) for key in keys}
            response = client.get("/api/reader/podcast/status", headers=auth)
            assert response.status_code == 200
            assert response.json()["running"] is (expected is not None)
            assert response.json()["progress"] == (metadata_unavailable_detail("en", expected.wait_reason)[1] if expected else "")
            history = client.get("/api/schedulers/history", headers=auth)
            assert history.status_code == 200
            assert history.json()["items"][0]["message"] == "Podcast generation failed."
        with Session(engine) as db:
            db.query(Membership).filter_by(user_id=alice.user_id, workspace_id=alice.workspace_id).update({"role": "viewer"})
            db.commit()
        downgraded = client.get("/api/reader/podcast/status", headers=cases[0][0]).json()
        assert not downgraded["running"] and downgraded["error"] is None and not downgraded["progress"]
        task = client.get("/api/schedulers/generate_podcast", headers=cases[0][0]).json()
        assert all(task[key] is None for key in keys)
        # Membership or cloud failures while resolving the selected vault cannot add private details.
        monkeypatch.setattr(workspace_service, "load_params", lambda **_: (_ for _ in ()).throw(
            MetadataUnavailable(path=Path(alice.vault_path) / "private-settings.yaml")))
        task = client.get("/api/schedulers/generate_podcast", headers=cases[0][0]).json()
        assert task["enabled"] and all(task[key] is None for key in keys)


@pytest.mark.parametrize("blocked_at", ["preparation", "worker"])
def test_activity_resume_keeps_daily_wait_and_recovers_on_next_clock(monkeypatch, isolated_validation_runtime, blocked_at):
    import asyncio
    from unittest.mock import Mock

    root = isolated_validation_runtime
    scope, manager, _ = runtime(monkeypatch, root)
    episode = episodes.claim(scope.vault_path, source="scheduler", scope=scope)
    with execution_scope(scope):
        snapshot, _, _ = audio._resolve_podcast_llm()
        execution.create_job_run(snapshot, episode.run_id, "podcast")
        store.update(scope, episode.run_id, status="failed", error="earlier attempt")
        episodes.finish(episode, "error")
        with monkeypatch.context() as patch:
            class ImmediateThread:
                def __init__(self, target, args, **kwargs):
                    self.invoke = lambda: target(*args)
                def start(self):
                    self.invoke()
            failure = MetadataUnavailable(path=Path(scope.vault_path) / "OneDrive" / "article.md", reason="offline")
            target = "_refresh_podcast_upstream" if blocked_at == "preparation" else "_generate_daily_podcast"
            patch.setattr(audio, target, Mock(side_effect=failure))
            patch.setattr(audio.threading, "Thread", ImmediateThread)
            patch.setattr(execution, "revalidate_scope", lambda selected: selected == scope or pytest.fail("scope changed"))
            result = asyncio.run(execution.resume_run(episode.run_id))
    assert result.status == "waiting" and result.run_id == episode.run_id
    pending = episodes.current(scope.vault_path)
    assert pending.status == "waiting" and pending.worker == {} and pending.run_id == episode.run_id
    assert pending.wait_reason == "offline" and pending.waiting_file == "article.md"
    assert pending.period_end == episode.period_end and pending.scope == scope.model_dump()
    manager._tasks["generate_podcast"].enabled = False
    assert manager._is_due(manager._tasks["generate_podcast"], datetime.fromisoformat(pending.retry_at))
    assert manager.run_task_now("generate_podcast", automatic=True)["success"]
    assert episodes.current(scope.vault_path).status == "success"
    assert store.read(scope, episode.run_id).status == "completed"
    assert len(list(Path(scope.vault_path).rglob("*.mp3"))) == 1


@pytest.mark.parametrize("scheduled", [True, False], ids=["existing-scheduler-history", "reader-only"])
def test_activity_worker_updates_only_existing_scheduler_history(monkeypatch, isolated_validation_runtime, scheduled):
    import asyncio
    from threading import Event
    from sqlalchemy.orm import Session
    from backend.models.scheduler import TaskExecutionHistory
    from backend.scheduler import execution as scheduled_execution

    root = isolated_validation_runtime
    scope, manager, engine = runtime(monkeypatch, root)
    monkeypatch.setattr(execution, "revalidate_scope", lambda selected: selected == scope or pytest.fail("scope changed"))
    monkeypatch.setattr(scheduled_execution, "get_mgmt_session", lambda: Session(engine))
    monkeypatch.setattr("backend.scheduler.manager.scheduler_manager._language", "en")
    entered, release, finished = Event(), Event(), Event()
    original_worker = audio._run_reader_episode
    original_generation = audio._generate_daily_podcast
    def observe(*args):
        try:
            original_worker(*args)
        finally:
            finished.set()
    monkeypatch.setattr(audio, "_run_reader_episode", observe)

    def failure(reason):
        raise MetadataUnavailable(path=Path(scope.vault_path) / "OneDrive" / "private-input.md", reason=reason)

    def assert_history(expected):
        with Session(engine) as db:
            rows = db.query(TaskExecutionHistory).all()
            if not scheduled:
                assert not rows
                return
            assert len(rows) == 1 and rows[0].id == episode.run_id and rows[0].status == expected
            row = rows[0]
            if expected == "running":
                assert row.message is None and row.finished_at is None and row.duration_seconds is None
            else:
                assert row.message == scheduled_execution.podcast_history_message(expected)
                assert row.finished_at is not None
                if expected == "success":
                    assert row.duration_seconds > 0

    with execution_scope(scope):
        monkeypatch.setattr(audio, "_generate_daily_podcast", lambda: failure("offline"))
        if scheduled:
            assert manager.run_task_now("generate_podcast", automatic=True)["status"] == "waiting"
        else:
            assert audio.start_generation_async() and finished.wait(10)
        episode = episodes.current(scope.vault_path)
        assert_history("waiting")
        for blocked, expected in (("pending", "waiting"), ("no_space", "error"), (None, "success")):
            entered.clear()
            release.clear()
            finished.clear()
            def generate():
                entered.set()
                assert release.wait(10)
                return failure(blocked) if blocked else original_generation()
            monkeypatch.setattr(audio, "_generate_daily_podcast", generate)
            asyncio.run(execution.resume_run(episode.run_id))
            try:
                assert entered.wait(10)
                assert_history("running")
            finally:
                release.set()
            assert finished.wait(10)
            assert episodes.current(scope.vault_path).status == expected
            assert_history(expected)
    # A delayed projection carrying the initial 'waiting' snapshot cannot undo publication.
    scheduled_execution.sync_podcast_history(episode)
    assert_history("success")
    assert store.read(scope, episode.run_id).status == "completed"
    assert len(list(Path(scope.vault_path).rglob("*.mp3"))) == 1
    if scheduled:
        # Simulate a stop in between committing the occurrence and updating its separate history DB.
        with Session(engine) as db:
            db.query(TaskExecutionHistory).filter_by(id=episode.run_id).update({"status": "waiting", "message": "old"})
            db.commit()
        from backend.scheduler import manager as scheduler
        monkeypatch.setattr(scheduler, "wait_before_automatic_dispatch", lambda _: False)
        manager._running = False
        manager._run_loop()
        with Session(engine) as db:
            restored = db.get(TaskExecutionHistory, episode.run_id)
            assert restored.status == "success" and restored.message == scheduled_execution.podcast_history_message("success")


def test_activity_resume_and_occurrence_claim_roll_back_together(monkeypatch, isolated_validation_runtime):
    import asyncio
    scope, _, _ = runtime(monkeypatch, isolated_validation_runtime)
    monkeypatch.setattr(execution, "revalidate_scope", lambda selected: selected == scope or pytest.fail("scope changed"))
    episode = episodes.claim(scope.vault_path, source="reader", scope=scope)
    with execution_scope(scope):
        snapshot, _, _ = audio._resolve_podcast_llm()
        execution.create_job_run(snapshot, episode.run_id, "podcast")
        store.update(scope, episode.run_id, status="failed")
        with pytest.raises(ValueError, match="podcast_generation_already_running"):
            asyncio.run(execution.resume_run(episode.run_id))
    assert store.read(scope, episode.run_id).status == "failed"
    assert episodes.current(scope.vault_path).worker == episode.worker
    assert not (isolated_validation_runtime / "observations").exists()


def test_interrupted_reader_episode_resumes_under_original_scope_with_schedule_disabled(
    monkeypatch, isolated_validation_runtime,
):
    from sqlalchemy.orm import Session

    from backend.models.scheduler import TaskExecutionHistory

    root = isolated_validation_runtime
    process = subprocess.run([sys.executable, "-m", __name__, str(root), "mid_script", "reader"],
                             capture_output=True, timeout=45)
    assert process.returncode == 86, process.stderr.decode()[-2000:]
    scope, manager, engine = runtime(monkeypatch, root)
    episode = episodes.current(scope.vault_path)
    assert episode.source == "reader" and episode.scope == scope.model_dump()
    assert store.latest_job(scope, "podcast").origin == "button"
    manager._tasks["generate_podcast"].enabled = False
    assert manager._is_due(manager._tasks["generate_podcast"], datetime.now())
    assert manager.run_task_now("generate_podcast", automatic=True)["success"]
    assert store.read(scope, episode.run_id).status == "completed"
    with Session(engine) as db:
        assert db.get(TaskExecutionHistory, episode.run_id) is None


def test_cancelled_waiter_is_never_claimed_and_revoked_scope_never_reaches_provider(
    monkeypatch, isolated_validation_runtime,
):
    from backend.services import agent_execution_scope
    root = isolated_validation_runtime
    scope, manager, _ = runtime(monkeypatch, root)
    error = MetadataUnavailable("remote input", path=Path(scope.vault_path) / "params.yaml", reason="offline")
    def offline():
        raise error
    monkeypatch.setattr(audio, "_generate_daily_podcast", offline)
    assert manager.run_task_now("generate_podcast")["status"] == "waiting"
    episode = episodes.current(scope.vault_path)
    assert store.read(scope, episode.run_id).status == "waiting"
    store.cancel(scope, episode.run_id)
    monkeypatch.setattr(audio, "_generate_daily_podcast", lambda: pytest.fail("cancelled run reached model"))
    assert manager.run_task_now("generate_podcast", automatic=True)["status"] == "error"
    assert store.read(scope, episode.run_id).status == "cancelled"
    assert store.cancelled(scope, episode.run_id)
    def revoked(_):
        raise PermissionError("private membership data")
    monkeypatch.setattr(agent_execution_scope, "revalidate_scope", revoked)
    assert manager.run_task_now("generate_podcast")["status"] == "error"
    private = episodes.current(scope.vault_path)
    assert private.wait_reason == "permission" and private.retry_at is None
    assert manager.get_task("generate_podcast").get("wait_reason") is None
    assert not (root / "observations").exists()


@pytest.mark.parametrize("legacy_status", ["interrupted", "cancelled", "failed"])
def test_existing_running_schedule_adopts_only_its_original_live_or_interrupted_parent(
    monkeypatch, isolated_validation_runtime, legacy_status,
):
    scope, manager, _ = runtime(monkeypatch, isolated_validation_runtime)
    task = manager._tasks["generate_podcast"]
    task.status, task.last_run = "running", datetime.now().isoformat()
    with execution_scope(scope, origin="automation"):
        snapshot, _, _ = audio._resolve_podcast_llm()
        execution.create_job_run(snapshot, "old-parent", "podcast")
        store.update(scope, "old-parent", status=legacy_status)
    assert manager._is_due(task, datetime.now())
    manager.run_task_now("generate_podcast", automatic=True)
    assert episodes.current(scope.vault_path).run_id == "old-parent"
    if legacy_status == "interrupted":
        assert store.read(scope, "old-parent").status == "completed"
    else:
        assert store.read(scope, "old-parent").status == legacy_status
        assert not (isolated_validation_runtime / "observations").exists()


def test_recovery_publishes_from_an_existing_vault_cache_receipt_without_synthesis(
    monkeypatch, isolated_validation_runtime,
):
    root = isolated_validation_runtime
    scope, manager, _ = runtime(monkeypatch, root)
    episode = episodes.claim(scope.vault_path, source="scheduler", scope=scope)
    with execution_scope(scope, origin="automation"):
        snapshot, _, _ = audio._resolve_podcast_llm()
        execution.create_job_run(snapshot, episode.run_id, "podcast")
        store.update(scope, episode.run_id, status="interrupted")
    legacy_cache = audio.get_podcast_output_dir(scope.vault_path) / ".generated" / "legacy.mp3"
    legacy_cache.parent.mkdir(parents=True)
    legacy_cache.write_bytes(b"original cached speech")
    store.work_checkpoint(scope, episode.run_id, "podcast-speech",
                          {"filename": "daily_podcast_fixture.mp3", "cache_file": legacy_cache.name})
    episodes.finish(episode, "running")
    assert manager.run_task_now("generate_podcast", automatic=True)["success"]
    published = audio.get_podcast_output_dir(scope.vault_path) / "daily_podcast_fixture.mp3"
    assert published.read_bytes() == legacy_cache.read_bytes()
    assert (root / "observations").read_text().splitlines() == ["publication"]


def test_latest_download_streams_the_same_daily_episode_as_reader_info(monkeypatch, isolated_validation_runtime):
    import asyncio
    import httpx
    from fastapi import FastAPI
    from backend.domains.reader.podcast_routes import get_latest_podcast, get_podcast_info

    scope, _, _ = runtime(monkeypatch, isolated_validation_runtime)
    output = audio.get_podcast_output_dir(scope.vault_path)
    output.mkdir(parents=True)
    (output / "daily_podcast_2026_01_02.mp3").write_bytes(b"published episode")
    (output / "speech-unrelated.mp3").write_bytes(b"unrelated playback")
    (output / "voice-memo.mp3").write_bytes(b"a recording saved by the user")
    app = FastAPI()
    app.get("/latest")(get_latest_podcast)
    async def get():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/latest")
    with execution_scope(scope):
        assert get_podcast_info()["filename"] == "daily_podcast_2026_01_02.mp3"
        response = asyncio.run(get())
    assert response.content == b"published episode" and response.headers["content-type"] == "audio/mpeg"


def test_reused_pid_does_not_hold_a_daily_episode(monkeypatch):
    from datetime import datetime, timezone
    import psutil

    now = datetime.now(timezone.utc)
    other = 987654321
    class Process:
        def __init__(self, pid):
            assert pid == other
        def create_time(self):
            return now.timestamp()
        def status(self):
            return psutil.STATUS_RUNNING

    monkeypatch.setattr(psutil, "Process", Process)
    old = now.timestamp() - 3600
    episode = episodes.Episode("/vault", "episode",
        datetime.fromtimestamp(old, timezone.utc).isoformat(), now.date().isoformat(), "scheduler",
        worker={"_worker_pid": other, "_worker_instance": "previous"})
    assert episode.due(now)  # Legacy lease, last seen before this process existed.
    episode.worker["_worker_created_at"] = old
    assert episode.due(now)
    episode.worker["_worker_created_at"] = now.timestamp()
    assert not episode.due(now)


if __name__ == "__main__":
    with pytest.MonkeyPatch.context() as patch:
        scope, manager, _ = runtime(patch, Path(sys.argv[1]), sys.argv[2])
        if sys.argv[3:] == ["reader"]:
            import threading
            with execution_scope(scope):
                assert audio.start_generation_async()
            threading.Event().wait(10)
        else:
            manager.run_task_now("generate_podcast")
