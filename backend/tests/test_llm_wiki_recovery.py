"""Rate-limit recovery and durable fragment reuse without live provider calls."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from openai import APIStatusError, RateLimitError

from backend.domains.llm_wiki import recovery
from backend.services import llm_wiki, llm_wiki_storage


@dataclass
class Clock:
    now: float = 0
    waits: list[float] = field(default_factory=list)

    def sleep(self, seconds: float) -> None:
        self.waits.append(seconds)
        self.now += seconds


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(recovery.time, "monotonic", lambda: clock.now)
    monkeypatch.setattr(recovery.time, "sleep", clock.sleep)
    monkeypatch.setattr(recovery.random, "uniform", lambda *_args: 0)
    return clock


def provider_error(
    status: int = 429, *, headers: dict[str, str] | None = None, code: str = "1300",
) -> APIStatusError:
    body = {"object": "error", "message": "Rate limit exceeded", "type": "rate_limited", "code": code}
    response = httpx.Response(
        status, headers=headers, request=httpx.Request("POST", "https://provider.invalid/chat"),
    )
    error_type = RateLimitError if status == 429 else APIStatusError
    return error_type("Rate limit exceeded", response=response, body=body)


def test_mistral_1300_retries_the_same_call_and_reports_waiting(clock: Clock) -> None:
    call = Mock(side_effect=[provider_error(), ("answer", "devstral-latest")])
    waiting, attempting = Mock(), Mock()
    assert recovery.call_with_retry(call, on_wait=waiting, on_attempt=attempting) == (
        "answer", "devstral-latest",
    )
    assert clock.waits == [5]
    assert call.call_count == 2
    assert attempting.call_count == 2
    waiting.assert_called_once_with()


@pytest.mark.parametrize("headers, expected", [
    ({"Retry-After": "45"}, 45),
    ({"Retry-After-Ms": "55000"}, 55),
    ({"Retry-After": "invalid"}, 5),
    ({"Retry-After": "0"}, 5),
])
def test_provider_cooldown_is_a_minimum(
    clock: Clock, headers: dict[str, str], expected: float,
) -> None:
    call = Mock(side_effect=[provider_error(headers=headers), "ok"])
    assert recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock()) == "ok"
    assert clock.waits == [expected]


def test_retry_after_http_date(clock: Clock) -> None:
    date = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=40), usegmt=True)
    call = Mock(side_effect=[provider_error(headers={"retry-after": date}), "ok"])
    recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock())
    assert 38 <= clock.waits[0] <= 40


def test_persistent_rate_limit_exhausts_four_retries(clock: Clock) -> None:
    error = provider_error()
    call = Mock(side_effect=error)
    with pytest.raises(RateLimitError) as raised:
        recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock())
    assert raised.value is error
    assert call.call_count == 5
    assert clock.waits == [5, 10, 20, 40]


@pytest.mark.parametrize("cooldown", ["121", "3600", "inf", "nan"])
def test_long_cooldown_stops_without_retrying_early(clock: Clock, cooldown: str) -> None:
    call = Mock(side_effect=provider_error(headers={"Retry-After": cooldown}))
    with pytest.raises(RateLimitError):
        recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock())
    call.assert_called_once()
    assert clock.waits == []


def test_cumulative_wait_budget_is_bounded(clock: Clock) -> None:
    call = Mock(side_effect=provider_error(headers={"Retry-After": "60"}))
    with pytest.raises(RateLimitError):
        recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock())
    assert clock.waits == [60, 60]
    assert call.call_count == 3


def test_slow_calls_share_an_overall_deadline(clock: Clock) -> None:
    timeouts: list[int] = []

    def call(timeout: int) -> str:
        timeouts.append(timeout)
        clock.now += timeout
        raise provider_error()

    with pytest.raises(RateLimitError):
        recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock())
    assert timeouts == [240, 115]
    assert clock.now == 360


@pytest.mark.parametrize("error", [
    provider_error(401), provider_error(403), provider_error(400),
    provider_error(code="insufficient_quota"),
    provider_error(code="billing_hard_limit_reached"),
    ValueError("invalid plan"),
])
def test_permanent_errors_are_not_retried(clock: Clock, error: Exception) -> None:
    call = Mock(side_effect=error)
    with pytest.raises(type(error)):
        recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock())
    call.assert_called_once()
    assert clock.waits == []


@pytest.mark.parametrize("error", [
    provider_error(503), httpx.ReadTimeout("temporary timeout"),
    httpx.ConnectError("temporary connection failure"),
])
def test_other_transient_provider_errors_recover(clock: Clock, error: Exception) -> None:
    call = Mock(side_effect=[error, "ok"])
    assert recovery.call_with_retry(call, on_wait=Mock(), on_attempt=Mock()) == "ok"
    assert clock.waits == [5]


@pytest.fixture
def ingest(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Exercise the real ingestion and job storage using two small source chunks."""
    monkeypatch.setattr(llm_wiki_storage, "local_root", lambda: tmp_path)
    monkeypatch.setattr(llm_wiki_storage, "_JOBS", {})
    monkeypatch.setattr(llm_wiki_storage, "_RUNNING_BY_RESOURCE", {})
    origins = [{"content_hash": "source-v1", "segments": []}]
    chunks = [{"id": "one"}, {"id": "two"}]
    monkeypatch.setattr(llm_wiki.llm_wiki_config, "load_config", lambda: {})
    monkeypatch.setattr(
        llm_wiki.llm_wiki_extractors, "extract_resource_sources", lambda *_args: (origins, []),
    )
    monkeypatch.setattr(llm_wiki_storage, "save_snapshot", lambda *_args: {"snapshot_id": "v1"})
    monkeypatch.setattr(llm_wiki.llm_wiki_extractors, "chunk_origins", lambda _origins: chunks)
    monkeypatch.setattr(llm_wiki, "_load_brain_index", lambda *_args: [])
    monkeypatch.setattr(llm_wiki, "_dimension_context", lambda *_args: ({}, []))
    monkeypatch.setattr(
        llm_wiki, "_build_chunk_prompt",
        lambda chunk, title, _index, language, _dimensions: f"{chunk['id']}:{title}:{language}",
    )
    monkeypatch.setattr(llm_wiki, "_parse_plan", json.loads)
    monkeypatch.setattr(
        llm_wiki, "_validate_and_reduce_plans",
        lambda plans, *_args: ([note for _, plan in plans for note in plan["notes"]], []),
    )
    apply = Mock(return_value={"created": ["Note one", "Note two"], "updated": []})
    monkeypatch.setattr(llm_wiki, "_apply_plan", apply)
    monkeypatch.setattr(
        llm_wiki.llm_wiki_pdf_annotations, "sync_generated_pdf_annotations", lambda *_args: {},
    )
    monkeypatch.setattr(llm_wiki_storage, "load_manifest", lambda *_args: {})
    monkeypatch.setattr(llm_wiki_storage, "save_manifest", lambda *_args: None)
    monkeypatch.setattr(llm_wiki.llm_wiki_indices, "rebuild_indexes", lambda *_args: {})
    monkeypatch.setattr(llm_wiki.llm_wiki_indices, "append_log", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(llm_wiki, "_on_ingest_success", lambda *_args: None)

    def run(*, job_id: str, resume_job_id: str = "", language: str = "English"):
        return llm_wiki.process_resource(
            "resource", "Book", {}, "", "brain", tmp_path,
            source_table_id="sources", source_table={"id": "sources"},
            source_config={"table_id": "sources"}, job_id=job_id,
            resume_job_id=resume_job_id, language=language,
        )

    return run, apply, chunks


def answer(key: str) -> tuple[str, str]:
    return json.dumps({"summary": key, "notes": [{"managed_key": key}]}), "test-model"


def test_chunk_retry_preserves_progress_and_writes_once(monkeypatch, clock, ingest) -> None:
    run, apply, _chunks = ingest
    observed = []
    job_id = str(llm_wiki_storage.create_job("sources", "resource")["job_id"])

    def sleep(seconds: float) -> None:
        observed.append(llm_wiki_storage.get_job_status(job_id))
        clock.sleep(seconds)

    monkeypatch.setattr(recovery.time, "sleep", sleep)
    generate = Mock(side_effect=[answer("one"), provider_error(), answer("two")])
    monkeypatch.setattr("backend.agent.factory.generate_text", generate)
    run(job_id=job_id)
    assert observed[0]["phase"] == "retrying"
    assert observed[0]["running"] is True
    assert observed[0]["chunks_done"] == 1
    assert observed[0]["progress"] == 40
    assert generate.call_args_list[1] == generate.call_args_list[2]
    assert llm_wiki_storage.get_job_status(job_id)["chunks_done"] == 2
    apply.assert_called_once()


@pytest.mark.parametrize("changed", ["none", "source", "language"])
def test_resume_only_reuses_matching_completed_fragments(monkeypatch, clock, ingest, changed) -> None:
    run, apply, chunks = ingest
    first = str(llm_wiki_storage.create_job("sources", "resource")["job_id"])
    generate = Mock(side_effect=[answer("one"), *[provider_error() for _ in range(5)]])
    monkeypatch.setattr("backend.agent.factory.generate_text", generate)
    with pytest.raises(RateLimitError):
        run(job_id=first)
    apply.assert_not_called()
    llm_wiki_storage.finish_job(first, phase="partial")
    second = str(llm_wiki_storage.create_job("sources", "resource")["job_id"])
    if changed == "source":
        chunks[0]["id"] = "changed"
    generate = Mock(side_effect=[answer("one"), answer("two")])
    monkeypatch.setattr("backend.agent.factory.generate_text", generate)
    run(job_id=second, resume_job_id=first, language="French" if changed == "language" else "English")
    assert generate.call_count == (1 if changed == "none" else 2)
    assert llm_wiki_storage.load_checkpoint(second, "plan-1")
    assert llm_wiki_storage.load_checkpoint(second, "plan-2")
    assert llm_wiki_storage.get_job_status(second)["chunks_done"] == 2
    apply.assert_called_once()


def test_failed_resume_carries_reused_fragments_into_the_next_job(monkeypatch, clock, ingest) -> None:
    run, apply, _chunks = ingest
    previous = ""
    for attempt in range(3):
        current = str(llm_wiki_storage.create_job("sources", "resource")["job_id"])
        responses = ([answer("one")] if attempt == 0 else []) + [provider_error() for _ in range(5)]
        generate = Mock(side_effect=responses)
        monkeypatch.setattr("backend.agent.factory.generate_text", generate)
        with pytest.raises(RateLimitError):
            run(job_id=current, resume_job_id=previous)
        assert generate.call_count == (6 if attempt == 0 else 5)
        assert llm_wiki_storage.load_checkpoint(current, "plan-1")
        llm_wiki_storage.finish_job(current, phase="partial")
        previous = current
    apply.assert_not_called()


@pytest.mark.parametrize("force", [False, True])
def test_worker_resumes_a_failed_job_unless_forced(monkeypatch, clock, ingest, tmp_path, force) -> None:
    _run, _apply, _chunks = ingest

    class InlineThread:
        def __init__(self, *, target, **_kwargs):
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(llm_wiki.threading, "Thread", InlineThread)
    monkeypatch.setattr("backend.services.context_vars.get_active_vault_path", lambda: None)
    generate = Mock(side_effect=[answer("one"), *[provider_error() for _ in range(5)]])
    monkeypatch.setattr("backend.agent.factory.generate_text", generate)
    kwargs = dict(
        source_table_id="sources", source_table={"id": "sources"},
        source_config={"table_id": "sources"},
    )
    first = llm_wiki.start_ingest("resource", "Book", {}, "", "brain", tmp_path, **kwargs)
    status = llm_wiki_storage.get_job_status(str(first["job_id"]))
    assert status["phase"] == "partial"
    assert status["running"] is False
    assert status["progress"] == 40
    assert "Rate limit" in status["error"]
    generate = Mock(side_effect=[answer("one"), answer("two")])
    monkeypatch.setattr("backend.agent.factory.generate_text", generate)
    second = llm_wiki.start_ingest("resource", "Book", {}, "", "brain", tmp_path, force=force, **kwargs)
    assert generate.call_count == (2 if force else 1)
    assert llm_wiki_storage.get_job_status(str(second["job_id"]))["phase"] == "done"
