"""Durable worker regressions for provider-owned state reconciliation."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def test_reader_dispatch_rejects_an_orphaned_queue_item(tmp_path, monkeypatch) -> None:
    from backend.services import durable_job_queue
    from backend.services import durable_job_worker as worker
    from backend.services import reader_analysis

    job_id = "a" * 32
    item = {
        "job_id": job_id,
        "job_type": "reader_analysis",
        "payload": {"vault_path": str(tmp_path), "job_id": job_id},
    }
    rejected: list[tuple[str, str]] = []
    launches: list[tuple[Path, str]] = []

    def missing_status(_vault_path: Path, _job_id: str) -> dict[str, Any]:
        raise KeyError(_job_id)

    monkeypatch.setattr(worker, "_DISPATCHERS", {})
    monkeypatch.setattr(durable_job_queue, "reconcile_expired", lambda: 0)
    monkeypatch.setattr(durable_job_queue, "ready_jobs", lambda *, limit: [item])
    monkeypatch.setattr(
        durable_job_queue,
        "reject",
        lambda queued_job_id, reason: rejected.append((queued_job_id, reason)),
    )
    monkeypatch.setattr(reader_analysis, "get_status", missing_status)
    monkeypatch.setattr(
        reader_analysis,
        "_launch",
        lambda vault_path, queued_job_id, *, model_call: launches.append(
            (vault_path, queued_job_id)
        ),
    )

    assert worker.DurableJobWorker().run_once() == 0
    assert launches == []
    assert rejected == [
        (
            job_id,
            "Durable Reader provider state is missing; the orphaned queue item was rejected.",
        )
    ]
