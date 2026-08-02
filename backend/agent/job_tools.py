"""Governed tools for provider-neutral durable capability jobs."""
from __future__ import annotations

import json
from typing import Any, Dict

from langchain_core.tools import tool


def _vault_path():
    from backend.services.context_vars import get_active_vault_path

    return get_active_vault_path()


@tool
def list_capability_jobs(provider: str = "", limit: int = 20) -> str:
    """List recent durable capability jobs and their supported operations."""
    from backend.services.capability_jobs import list_jobs

    return json.dumps(
        list_jobs(_vault_path(), provider=provider, limit=limit),
        ensure_ascii=False,
        default=str,
    )


@tool
def capability_job_status(job_id: str) -> str:
    """Read exact status for a namespaced durable capability job."""
    from backend.services.capability_jobs import get_job_status

    return json.dumps(get_job_status(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def read_capability_job_result(job_id: str) -> str:
    """Read the durable result of a completed namespaced capability job."""
    from backend.services.capability_jobs import read_job_result

    return json.dumps(read_job_result(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def estimate_capability_job(
    provider: str,
    kind: str,
    parameters: Dict[str, Any] | None = None,
) -> str:
    """Estimate corpus size and model calls without starting a capability job."""
    from backend.services.capability_jobs import estimate_job

    return json.dumps(
        estimate_job(_vault_path(), provider, kind, parameters or {}),
        ensure_ascii=False,
        default=str,
    )


@tool
def resume_capability_job(job_id: str) -> str:
    """Resume a supported interrupted job after an explicit cost authorization."""
    from backend.services.capability_jobs import resume_job

    return json.dumps(resume_job(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def cancel_capability_job(job_id: str) -> str:
    """Request cooperative cancellation of a supported running capability job."""
    from backend.services.capability_jobs import cancel_job

    return json.dumps(cancel_job(_vault_path(), job_id), ensure_ascii=False, default=str)


JOB_READ_TOOLS = [
    list_capability_jobs,
    capability_job_status,
    read_capability_job_result,
    estimate_capability_job,
]
JOB_AI_TOOLS = [resume_capability_job]
JOB_WRITE_TOOLS = [cancel_capability_job]
