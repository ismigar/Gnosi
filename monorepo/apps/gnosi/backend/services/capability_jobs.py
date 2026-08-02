"""Provider-neutral facade for durable Gnosi capability jobs."""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional


PROVIDER_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
LOCAL_JOB_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,191}$")
MAX_JOB_LIST = 100


JobList = Callable[[Path, int], Iterable[Dict[str, Any]]]
JobAction = Callable[[Path, str], Dict[str, Any]]
JobEstimate = Callable[[Path, str, Dict[str, Any]], Dict[str, Any]]


@dataclass(frozen=True)
class JobProvider:
    """Durable-job operations implemented by one authoritative service."""

    name: str
    list_jobs: JobList
    get_status: JobAction
    read_result: Optional[JobAction] = None
    resume: Optional[JobAction] = None
    cancel: Optional[JobAction] = None
    estimate: Optional[JobEstimate] = None


_LOCK = threading.RLock()
_PROVIDERS: Dict[str, JobProvider] = {}
_BUILTINS_READY = False


def _normalize_provider(value: str) -> str:
    provider = str(value or "").strip().lower()
    if not PROVIDER_RE.fullmatch(provider):
        raise ValueError("Invalid capability job provider.")
    return provider


def _normalize_local_id(value: str) -> str:
    local_id = str(value or "").strip()
    if not LOCAL_JOB_RE.fullmatch(local_id):
        raise ValueError("Invalid capability job id.")
    return local_id


def qualify_job_id(provider: str, local_id: str) -> str:
    """Return the stable public id for a provider-owned job."""
    return f"{_normalize_provider(provider)}:{_normalize_local_id(local_id)}"


def split_job_id(job_id: str) -> tuple[str, str]:
    """Validate and split a public namespaced job id."""
    raw = str(job_id or "").strip()
    if ":" not in raw:
        raise ValueError("Capability job ids must include their provider.")
    provider, local_id = raw.split(":", 1)
    return _normalize_provider(provider), _normalize_local_id(local_id)


def register_job_provider(provider: JobProvider, *, replace: bool = False) -> None:
    """Register one provider without allowing accidental shadowing."""
    normalized = _normalize_provider(provider.name)
    if normalized != provider.name:
        raise ValueError("Job provider names must already be normalized.")
    with _LOCK:
        if normalized in _PROVIDERS and not replace:
            raise ValueError(f"Capability job provider already exists: {normalized}")
        _PROVIDERS[normalized] = provider


def _reader_provider() -> JobProvider:
    from backend.services import reader_analysis

    return JobProvider(
        name="reader",
        list_jobs=reader_analysis.list_analyses,
        get_status=reader_analysis.get_status,
        read_result=reader_analysis.read_result,
        resume=reader_analysis.resume_analysis,
        cancel=reader_analysis.cancel_analysis,
        estimate=lambda vault_path, kind, parameters: reader_analysis.estimate_analysis(
            vault_path,
            parameters.get("scope") or parameters,
            language=str(parameters.get("language") or "Catalan"),
            guidance=str(parameters.get("guidance") or ""),
        ) if kind == "topic_evolution" else _unsupported_kind("reader", kind),
    )


def _unsupported_kind(provider: str, kind: str) -> Dict[str, Any]:
    raise ValueError(f"Unsupported {provider} capability job kind: {kind}")


def _ensure_builtins() -> None:
    global _BUILTINS_READY
    with _LOCK:
        if _BUILTINS_READY:
            return
        _PROVIDERS.setdefault("reader", _reader_provider())
        _BUILTINS_READY = True


def _provider(name: str) -> JobProvider:
    _ensure_builtins()
    normalized = _normalize_provider(name)
    with _LOCK:
        provider = _PROVIDERS.get(normalized)
    if provider is None:
        raise KeyError(f"Unknown capability job provider: {normalized}")
    return provider


def _public_job(provider: JobProvider, payload: Dict[str, Any]) -> Dict[str, Any]:
    row = dict(payload or {})
    local_id = str(row.get("job_id") or row.get("id") or "")
    row["job_id"] = qualify_job_id(provider.name, local_id)
    row["provider"] = provider.name
    row["capabilities"] = {
        "result": provider.read_result is not None,
        "resume": provider.resume is not None,
        "cancel": provider.cancel is not None,
        "estimate": provider.estimate is not None,
    }
    return row


def list_jobs(
    vault_path: Path,
    *,
    provider: str = "",
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """List recent jobs across one or every registered provider."""
    _ensure_builtins()
    bounded = max(1, min(int(limit), MAX_JOB_LIST))
    providers = [_provider(provider)] if provider else list(_PROVIDERS.values())
    rows = []
    for adapter in providers:
        for payload in adapter.list_jobs(Path(vault_path), bounded):
            rows.append(_public_job(adapter, dict(payload)))
    rows.sort(
        key=lambda row: str(
            row.get("updated_at")
            or row.get("created_at")
            or row.get("started_at")
            or ""
        ),
        reverse=True,
    )
    return rows[:bounded]


def get_job_status(vault_path: Path, job_id: str) -> Dict[str, Any]:
    provider_name, local_id = split_job_id(job_id)
    provider = _provider(provider_name)
    return _public_job(provider, provider.get_status(Path(vault_path), local_id))


def read_job_result(vault_path: Path, job_id: str) -> Dict[str, Any]:
    provider_name, local_id = split_job_id(job_id)
    provider = _provider(provider_name)
    if provider.read_result is None:
        raise ValueError(f"Provider {provider_name} does not expose job results.")
    payload = dict(provider.read_result(Path(vault_path), local_id))
    payload["job_id"] = qualify_job_id(provider_name, local_id)
    payload["provider"] = provider_name
    return payload


def resume_job(vault_path: Path, job_id: str) -> Dict[str, Any]:
    provider_name, local_id = split_job_id(job_id)
    provider = _provider(provider_name)
    if provider.resume is None:
        raise ValueError(f"Provider {provider_name} does not support resume.")
    return _public_job(provider, provider.resume(Path(vault_path), local_id))


def cancel_job(vault_path: Path, job_id: str) -> Dict[str, Any]:
    provider_name, local_id = split_job_id(job_id)
    provider = _provider(provider_name)
    if provider.cancel is None:
        raise ValueError(f"Provider {provider_name} does not support cancellation.")
    return _public_job(provider, provider.cancel(Path(vault_path), local_id))


def estimate_job(
    vault_path: Path,
    provider: str,
    kind: str,
    parameters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    adapter = _provider(provider)
    if adapter.estimate is None:
        raise ValueError(f"Provider {adapter.name} does not support estimates.")
    estimate = dict(adapter.estimate(
        Path(vault_path),
        str(kind or "").strip().lower(),
        dict(parameters or {}),
    ))
    estimate.update({"provider": adapter.name, "kind": str(kind or "").strip().lower()})
    return estimate
