"""Process-local dispatcher for the durable capability queue.

The queue remains the source of truth. This worker only wakes up, discovers
ready payloads and asks the owning provider to claim them. Multiple API
processes may run the dispatcher safely because the queue lease is atomic.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Optional

from backend.config.logger_config import get_logger
from backend.services import durable_job_queue

log = get_logger(__name__)


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
        durable_job_queue.reconcile_expired()
        dispatched = 0
        for item in durable_job_queue.ready_jobs(limit=32):
            job_type = str(item.get("job_type") or "")
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            if job_type != "reader_analysis":
                durable_job_queue.reject(
                    str(item.get("job_id") or ""),
                    "No durable worker is registered for this job type.",
                )
                continue
            vault_path = str(payload.get("vault_path") or "").strip()
            job_id = str(payload.get("job_id") or item.get("job_id") or "").strip()
            if not vault_path or not job_id:
                log.warning("Ignoring malformed durable Reader job payload")
                durable_job_queue.reject(
                    str(item.get("job_id") or ""),
                    "Durable Reader job payload is missing vault_path or job_id.",
                )
                continue
            try:
                from backend.services import reader_analysis

                reader_analysis._launch(  # noqa: SLF001
                    Path(vault_path),
                    job_id,
                    model_call=reader_analysis._default_model_call,  # noqa: SLF001
                )
                dispatched += 1
            except Exception:  # noqa: BLE001
                log.exception("Could not dispatch durable Reader job %s", job_id)
        return dispatched

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:  # noqa: BLE001
                log.exception("Durable job dispatcher iteration failed")
            self._stop.wait(self.poll_seconds)


durable_job_worker = DurableJobWorker()
