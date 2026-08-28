"""Focused contracts for the extracted durable Reader-analysis domain."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import pytest

from backend.domains.reader import analysis, service, storage
from backend.services import durable_job_queue, reader_analysis


@pytest.fixture()
def reader_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Keep jobs, queue state and the vault entirely below pytest's temp tree."""
    local_data = tmp_path / "local-data"
    vault_path = tmp_path / "vault"
    vault_path.mkdir()

    def temp_params(*, strict_env: bool = False) -> SimpleNamespace:
        del strict_env
        return SimpleNamespace(paths={"LOCAL_DATA": local_data})

    monkeypatch.setattr(storage, "load_params", temp_params)
    monkeypatch.setattr(durable_job_queue, "load_params", temp_params)
    return vault_path


def _article() -> dict[str, Any]:
    return {
        "id": "1",
        "title": "Recoverable article",
        "source_id": 7,
        "source": "Example",
        "category": "Research",
        "published_at": "2026-01-01T00:00:00+00:00",
        "url": "https://example.test/1",
        "is_read": False,
        "content": "Evidence",
    }


def _successful_model(prompt: str, _message: str) -> str:
    if "BATCH ANALYSES:\n" in prompt:
        summaries = json.loads(prompt.split("BATCH ANALYSES:\n", 1)[1])
        return json.dumps(
            {
                "topic": "Research",
                "evolution": "Recovered",
                "turning_points": [],
                "article_ids": summaries[0]["article_ids"],
            }
        )
    articles = [json.loads(line) for line in prompt.split("ARTICLES:\n", 1)[1].splitlines()]
    return json.dumps(
        {
            "topic": "Research",
            "period_start": articles[0]["published_at"],
            "period_end": articles[-1]["published_at"],
            "article_count": len(articles),
            "summary": "Recovered",
            "developments": [],
            "article_ids": [item["id"] for item in articles],
        }
    )


def test_reader_job_persists_snapshot_checkpoints_and_result(
    reader_paths: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "_snapshot_articles", lambda _vault, _scope: [_article()])
    job = reader_analysis.start_analysis(
        reader_paths,
        {"unread_only": True},
        guidance="Preserve evidence",
        launch=False,
    )

    reader_analysis._run_job(
        reader_paths,
        str(job["job_id"]),
        model_call=_successful_model,
    )

    status = reader_analysis.get_status(reader_paths, str(job["job_id"]))
    result = reader_analysis.read_result(reader_paths, str(job["job_id"]))
    checkpoints = list(
        (reader_analysis._root(reader_paths) / "checkpoints" / str(job["job_id"])).glob("*.json")
    )
    assert status["state"] == "completed"
    assert status["snapshot_digest"]
    assert len(checkpoints) == status["total_batches"]
    assert result["article_count"] == 1
    assert result["request"] == "Preserve evidence"
    assert "/reader/article/1" in result["report_markdown"]
    assert reader_analysis._snapshot_path(reader_paths, str(job["job_id"])).exists()


def test_reader_job_retries_transient_failure_with_persisted_budget(
    reader_paths: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "_snapshot_articles", lambda _vault, _scope: [_article()])
    scheduled: list[tuple[int, Callable[[str, str], str]]] = []
    monkeypatch.setattr(
        service,
        "_schedule_retry",
        lambda _vault, _job, *, delay_seconds, model_call: scheduled.append(
            (delay_seconds, model_call)
        ),
    )
    calls = 0

    def flaky_model(prompt: str, message: str) -> str:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TimeoutError("temporary provider timeout")
        return _successful_model(prompt, message)

    job = reader_analysis.start_analysis(reader_paths, {}, launch=False)
    job_id = str(job["job_id"])
    reader_analysis._run_job(reader_paths, job_id, model_call=flaky_model)
    waiting = reader_analysis.get_status(reader_paths, job_id)
    assert waiting["state"] == "retry_wait"
    assert waiting["retry"]["attempt"] == 1
    assert waiting["retry"]["model_calls_used"] == 1
    assert scheduled[0][0] == reader_analysis.DEFAULT_RETRY_BASE_SECONDS

    reader_analysis._run_job(reader_paths, job_id, model_call=scheduled[0][1])
    completed = reader_analysis.get_status(reader_paths, job_id)
    assert completed["state"] == "completed"
    assert completed["retry"]["attempt"] == 2
    assert completed["retry"]["model_calls_used"] == 3
    assert completed["retry"]["next_retry_at"] is None


def test_reader_facade_and_segmentation_contracts_are_preserved() -> None:
    assert reader_analysis.start_analysis is service.start_analysis
    assert reader_analysis._run_job is service._run_job
    assert reader_analysis._build_batches is analysis._build_batches

    content = "Long evidence. " * 8_000
    row = {**_article(), "id": "long-1", "content": content}
    batches = reader_analysis._build_batches([row])
    parts = [article for batch in batches for article in batch["articles"]]
    assert len(parts) > 1
    assert "".join(part["content"] for part in parts) == content
    assert [part["content_part"] for part in parts] == list(range(1, len(parts) + 1))
