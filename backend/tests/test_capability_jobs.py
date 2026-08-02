"""Provider-neutral durable capability job contracts."""
from pathlib import Path

import pytest

from backend.services.capability_jobs import (
    JobProvider,
    cancel_job,
    estimate_job,
    get_job_status,
    list_jobs,
    qualify_job_id,
    read_job_result,
    register_job_provider,
    resume_job,
    split_job_id,
)


def _provider(calls):
    def record(name, payload):
        calls.append((name, payload))
        return payload

    return JobProvider(
        name="testjobs",
        list_jobs=lambda _vault, _limit: [
            {"job_id": "job-1", "state": "completed", "updated_at": "2026-01-01"}
        ],
        get_status=lambda _vault, job_id: record(
            "status", {"job_id": job_id, "state": "completed"}
        ),
        read_result=lambda _vault, job_id: record(
            "result", {"job_id": job_id, "report": "done"}
        ),
        resume=lambda _vault, job_id: record(
            "resume", {"job_id": job_id, "state": "queued"}
        ),
        cancel=lambda _vault, job_id: record(
            "cancel", {"job_id": job_id, "state": "running"}
        ),
        estimate=lambda _vault, kind, parameters: record(
            "estimate", {"records": parameters["records"], "requested_kind": kind}
        ),
    )


def test_namespaced_job_ids_are_validated():
    assert qualify_job_id("reader", "abc123") == "reader:abc123"
    assert split_job_id("reader:abc123") == ("reader", "abc123")
    with pytest.raises(ValueError, match="provider"):
        split_job_id("abc123")
    with pytest.raises(ValueError, match="Invalid capability job"):
        split_job_id("reader:../../secret")


def test_provider_facade_preserves_capabilities_and_ids(tmp_path: Path):
    calls = []
    register_job_provider(_provider(calls), replace=True)

    rows = list_jobs(tmp_path, provider="testjobs")
    assert rows[0]["job_id"] == "testjobs:job-1"
    assert rows[0]["capabilities"] == {
        "result": True,
        "resume": True,
        "cancel": True,
        "estimate": True,
    }
    assert get_job_status(tmp_path, "testjobs:job-1")["provider"] == "testjobs"
    assert read_job_result(tmp_path, "testjobs:job-1")["job_id"] == "testjobs:job-1"
    assert resume_job(tmp_path, "testjobs:job-1")["state"] == "queued"
    assert cancel_job(tmp_path, "testjobs:job-1")["state"] == "running"
    estimate = estimate_job(
        tmp_path,
        "testjobs",
        "topic_evolution",
        {"records": 42},
    )
    assert estimate == {
        "records": 42,
        "requested_kind": "topic_evolution",
        "provider": "testjobs",
        "kind": "topic_evolution",
    }
    assert {name for name, _payload in calls} == {
        "status", "result", "resume", "cancel", "estimate"
    }


def test_unsupported_provider_operation_is_explicit(tmp_path: Path):
    register_job_provider(
        JobProvider(
            name="readonlyjobs",
            list_jobs=lambda _vault, _limit: [],
            get_status=lambda _vault, job_id: {"job_id": job_id, "state": "completed"},
        ),
        replace=True,
    )
    with pytest.raises(ValueError, match="does not support cancellation"):
        cancel_job(tmp_path, "readonlyjobs:job-1")
