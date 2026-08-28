"""Process-local dispatcher for the durable capability queue.

The queue remains the source of truth. This worker only wakes up, discovers
ready payloads and asks the owning provider to claim them. Multiple API
processes may run the dispatcher safely because the queue lease is atomic.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from backend.config.logger_config import get_logger
from backend.services import durable_job_queue

log = get_logger(__name__)
JobDispatcher = Callable[[dict[str, Any], dict[str, Any]], bool]


@dataclass(frozen=True)
class DurableJobDispatcherContract:
    """Versioned execution contract owned by one durable job provider."""

    job_type: str
    provider: str
    dispatch: JobDispatcher
    schema_version: int = 2
    idempotency: str = "idempotency_key_required"
    lease_seconds: int = 300
    max_attempts: int = 3
    model_call_budget: int = 0
    supports_resume: bool = True
    supports_cancel: bool = True


_DISPATCHERS: dict[str, DurableJobDispatcherContract] = {}
_DISPATCHER_LOCK = threading.RLock()


def register_job_dispatcher(
    job_type: str | DurableJobDispatcherContract,
    dispatcher: JobDispatcher | None = None,
    *,
    replace: bool = False,
) -> None:
    """Register a provider-owned durable queue dispatcher."""
    if isinstance(job_type, DurableJobDispatcherContract):
        contract = job_type
    else:
        if dispatcher is None:
            raise ValueError("Invalid durable job dispatcher contract.")
        contract = DurableJobDispatcherContract(
            job_type=str(job_type or ""),
            provider="legacy",
            dispatch=dispatcher,
            schema_version=1,
        )
    normalized = str(contract.job_type or "").strip().lower()
    if not normalized or len(normalized) > 96 or not callable(contract.dispatch):
        raise ValueError("Invalid durable job dispatcher contract.")
    if contract.schema_version >= 2:
        if (
            not str(contract.provider or "").strip()
            or contract.idempotency != "idempotency_key_required"
        ):
            raise ValueError("Durable job dispatcher v2 requires provider and idempotency policy.")
        if not 10 <= int(contract.lease_seconds) <= 3_600:
            raise ValueError("Durable job dispatcher lease is outside the supported range.")
        if (
            not 1 <= int(contract.max_attempts) <= 20
            or not 0 <= int(contract.model_call_budget) <= 64
        ):
            raise ValueError("Durable job dispatcher budgets are outside the supported range.")
    contract = DurableJobDispatcherContract(**{**contract.__dict__, "job_type": normalized})
    with _DISPATCHER_LOCK:
        if normalized in _DISPATCHERS and not replace:
            raise ValueError(f"Durable job dispatcher already registered: {normalized}")
        _DISPATCHERS[normalized] = contract


def _notebook_dispatcher(item: dict[str, Any], payload: dict[str, Any]) -> bool:
    vault_path = str(payload.get("vault_path") or "").strip()
    job_id = str(payload.get("job_id") or item.get("job_id") or "").strip()
    if not vault_path or not job_id:
        raise ValueError("Durable notebook payload is missing vault_path or job_id.")
    from backend.services import notebook_service

    if str(item.get("job_type")) == "notebook_ingest":
        notebook_service.launch_ingest(Path(vault_path), job_id)
    else:
        notebook_service.launch_analysis(Path(vault_path), job_id)
    return True


def _reader_dispatcher(item: dict[str, Any], payload: dict[str, Any]) -> bool:
    vault_path = str(payload.get("vault_path") or "").strip()
    job_id = str(payload.get("job_id") or item.get("job_id") or "").strip()
    if not vault_path or not job_id:
        raise ValueError("Durable Reader payload is missing vault_path or job_id.")
    from backend.services import reader_analysis

    try:
        reader_analysis.get_status(Path(vault_path), job_id)
    except KeyError as error:
        raise ValueError(
            "Durable Reader provider state is missing; the orphaned queue item was rejected."
        ) from error
    reader_analysis._launch(  # noqa: SLF001
        Path(vault_path),
        job_id,
        model_call=reader_analysis._default_model_call,  # noqa: SLF001
    )
    return True


def _literature_sync_dispatcher(item: dict[str, Any], payload: dict[str, Any]) -> bool:
    vault_path = str(payload.get("vault_path") or "").strip()
    source_id = str(payload.get("source_id") or "").strip()
    job_id = str(payload.get("job_id") or item.get("job_id") or "").strip()
    full = bool(payload.get("full", False))
    if not vault_path or not source_id or not job_id:
        raise ValueError(
            "Durable literature sync payload is missing vault_path, source_id, or job_id."
        )
    from backend.services import literature_service

    literature_service.launch_sync(Path(vault_path), source_id, job_id, full=full)
    return True


def _literature_review_dispatcher(item: dict[str, Any], payload: dict[str, Any]) -> bool:
    vault_path = str(payload.get("vault_path") or "").strip()
    review_id = str(payload.get("review_id") or "").strip()
    job_id = str(payload.get("job_id") or item.get("job_id") or "").strip()
    raw_strategy = payload.get("strategy")
    strategy: dict[str, Any] = dict(raw_strategy) if isinstance(raw_strategy, dict) else {}
    interval_days = int(payload.get("interval_days") or 7)
    if not vault_path or not review_id or not job_id:
        raise ValueError(
            "Durable literature review update payload is missing vault_path, review_id, or job_id."
        )
    from backend.services import literature_service

    literature_service.launch_review_update(
        Path(vault_path), review_id, job_id, strategy, interval_days=interval_days
    )
    return True


def _ensure_dispatchers() -> None:
    with _DISPATCHER_LOCK:
        _DISPATCHERS.setdefault(
            "notebook_ingest",
            DurableJobDispatcherContract(
                job_type="notebook_ingest",
                provider="notebook",
                dispatch=_notebook_dispatcher,
                model_call_budget=0,
            ),
        )
        _DISPATCHERS.setdefault(
            "notebook_analysis",
            DurableJobDispatcherContract(
                job_type="notebook_analysis",
                provider="notebook",
                dispatch=_notebook_dispatcher,
                model_call_budget=16,
            ),
        )
        _DISPATCHERS.setdefault(
            "reader_analysis",
            DurableJobDispatcherContract(
                job_type="reader_analysis",
                provider="reader",
                dispatch=_reader_dispatcher,
                model_call_budget=16,
            ),
        )
        _DISPATCHERS.setdefault(
            "academic_repository_sync",
            DurableJobDispatcherContract(
                job_type="academic_repository_sync",
                provider="literature",
                dispatch=_literature_sync_dispatcher,
                lease_seconds=3600,
                max_attempts=5,
                model_call_budget=0,
            ),
        )
        _DISPATCHERS.setdefault(
            "academic_review_update",
            DurableJobDispatcherContract(
                job_type="academic_review_update",
                provider="literature",
                dispatch=_literature_review_dispatcher,
                lease_seconds=3600,
                max_attempts=3,
                model_call_budget=0,
            ),
        )


def dispatcher_contracts() -> list[dict[str, Any]]:
    """Return public metadata for diagnostics without exposing callables."""
    _ensure_dispatchers()
    with _DISPATCHER_LOCK:
        contracts = list(_DISPATCHERS.values())
    return [
        {
            "schema_version": item.schema_version,
            "job_type": item.job_type,
            "provider": item.provider,
            "idempotency": item.idempotency,
            "lease_seconds": item.lease_seconds,
            "max_attempts": item.max_attempts,
            "model_call_budget": item.model_call_budget,
            "supports_resume": item.supports_resume,
            "supports_cancel": item.supports_cancel,
        }
        for item in sorted(contracts, key=lambda value: value.job_type)
    ]


class DurableJobWorker:
    """Small lifecycle-managed dispatcher for restart recovery."""

    def __init__(self, *, poll_seconds: float = 1.0) -> None:
        self.poll_seconds = max(0.1, min(float(poll_seconds), 30.0))
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="gnosi-durable-job-worker",
            daemon=True,
        )
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(max(0.1, min(float(timeout), 30.0)))
        self._thread = None

    def run_once(self) -> int:
        """Dispatch ready jobs and return how many were handed to providers."""
        _ensure_dispatchers()
        durable_job_queue.reconcile_expired()
        dispatched = 0
        for item in durable_job_queue.ready_jobs(limit=32):
            job_type = str(item.get("job_type") or "")
            raw_payload = item.get("payload")
            payload: dict[str, Any] = dict(raw_payload) if isinstance(raw_payload, dict) else {}
            with _DISPATCHER_LOCK:
                contract = _DISPATCHERS.get(job_type)
            if contract is None:
                durable_job_queue.reject(
                    str(item.get("job_id") or ""),
                    "No durable worker is registered for this job type.",
                )
                continue
            try:
                if contract.dispatch(item, payload):
                    dispatched += 1
            except ValueError as error:
                durable_job_queue.reject(str(item.get("job_id") or ""), str(error))
            except Exception:  # noqa: BLE001
                log.exception("Could not dispatch durable job %s", item.get("job_id"))
        return dispatched

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:  # noqa: BLE001
                log.exception("Durable job dispatcher iteration failed")
            self._stop.wait(self.poll_seconds)


durable_job_worker = DurableJobWorker()
