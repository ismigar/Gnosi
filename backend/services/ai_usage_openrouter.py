"""Reconcile billed costs through metadata-only GETs, outside model execution."""
from __future__ import annotations

import json
import logging
import threading
import queue
import urllib.parse
import urllib.request

from backend.services import ai_usage_ledger as ledger

log = logging.getLogger(__name__)
_pending: queue.Queue[tuple[str, str, str]] = queue.Queue(maxsize=32)
_workers_lock = threading.Lock()
_workers_started = False


def reconcile(call_id: str, generation_id: str, api_key: str) -> bool:
    if not generation_id.startswith("gen-") or not api_key:
        return False
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/generation?" + urllib.parse.urlencode({"id": generation_id}),
        headers={"Authorization": "Bearer " + api_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.load(response).get("data", {})
        if data.get("id") != generation_id:
            return False
        return ledger.reconcile_cost(call_id, generation_id, data.get("total_cost"))
    except Exception:
        # Never fabricate zero or log credentials/provider response bodies.
        log.warning("Billed usage metadata unavailable; keeping the recorded estimate")
        return False


def _worker() -> None:
    while True:
        call_id, generation_id, api_key = _pending.get()
        try:
            reconcile(call_id, generation_id, api_key)
        finally:
            _pending.task_done()


def schedule(call_id: str, generation_id: str, api_key: str) -> None:
    global _workers_started
    with _workers_lock:
        if not _workers_started:
            # Metadata lookups must never delay model execution or app shutdown.
            # The generation ID and estimate are durable before work is queued.
            for index in range(2):
                threading.Thread(target=_worker, name=f"usage-cost-{index}", daemon=True).start()
            _workers_started = True
    try:
        _pending.put_nowait((call_id, generation_id, api_key))
    except queue.Full:
        pass
