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
    status = restored.get_task("generate_podcast")
    assert status["waiting_file"] == "params.yaml" and status["waiting_provider"] == "OneDrive"
    assert status["wait_reason"] == reason and "Private Organization" not in str(status)
    assert not restored._is_due(restored._tasks["generate_podcast"], datetime.now())
    if retry:
        at = datetime.fromisoformat(status["retry_at"])
        assert at.tzinfo and restored._is_due(restored._tasks["generate_podcast"], at)
    else:
        assert status["retry_at"] is None and not restored._is_due(restored._tasks["generate_podcast"],
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


def test_interrupted_reader_episode_resumes_under_original_scope_with_schedule_disabled(
    monkeypatch, isolated_validation_runtime,
):
    root = isolated_validation_runtime
    process = subprocess.run([sys.executable, "-m", __name__, str(root), "mid_script", "reader"],
                             capture_output=True, timeout=45)
    assert process.returncode == 86, process.stderr.decode()[-2000:]
    scope, manager, _ = runtime(monkeypatch, root)
    episode = episodes.current(scope.vault_path)
    assert episode.source == "reader" and episode.scope == scope.model_dump()
    assert store.latest_job(scope, "podcast").origin == "button"
    manager._tasks["generate_podcast"].enabled = False
    assert manager._is_due(manager._tasks["generate_podcast"], datetime.now())
    assert manager.run_task_now("generate_podcast", automatic=True)["success"]
    assert store.read(scope, episode.run_id).status == "completed"


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
    public = manager.get_task("generate_podcast")
    assert public["wait_reason"] == "permission" and public["retry_at"] is None
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
    app = FastAPI()
    app.get("/latest")(get_latest_podcast)
    async def get():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get("/latest")
    with execution_scope(scope):
        assert get_podcast_info()["filename"] == "daily_podcast_2026_01_02.mp3"
        response = asyncio.run(get())
    assert response.content == b"published episode" and response.headers["content-type"] == "audio/mpeg"


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
