"""Reconcile billed costs through metadata-only GETs, outside model execution."""
from __future__ import annotations

import json
import logging
import heapq
import itertools
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from backend.services import ai_usage_ledger as ledger

log = logging.getLogger(__name__)
_condition = threading.Condition()
_pending: list[tuple[float, int, str, str, str, int]] = []
_active_calls: set[str] = set()
_sequence = itertools.count()
_RETRY_DELAYS = (2, 10, 30, 120, 300)
_MAX_PENDING = 128
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
    except Exception as error:
        # Never fabricate zero or log credentials/provider response bodies.
        status = error.code if isinstance(error, urllib.error.HTTPError) else type(error).__name__
        log.warning("Billed usage metadata unavailable (%s); keeping the recorded estimate", status)
        return False


def _attempt(call_id: str, generation_id: str, api_key: str, attempt: int) -> None:
    confirmed = reconcile(call_id, generation_id, api_key)
    with _condition:
        if not confirmed and attempt < len(_RETRY_DELAYS):
            heapq.heappush(_pending, (time.monotonic() + _RETRY_DELAYS[attempt], next(_sequence),
                                     call_id, generation_id, api_key, attempt + 1))
            _condition.notify_all()
        else:
            _active_calls.discard(call_id)


def _worker() -> None:
    while True:
        with _condition:
            while True:
                if not _pending:
                    _condition.wait()
                    continue
                delay = _pending[0][0] - time.monotonic()
                if delay > 0:
                    _condition.wait(timeout=delay)
                    continue
                _, _, call_id, generation_id, api_key, attempt = heapq.heappop(_pending)
                break
        # Waiting for delayed provider metadata must not occupy a worker or
        # block newer lookups. Only these metadata GETs are retried, never LLMs.
        _attempt(call_id, generation_id, api_key, attempt)


def schedule(call_id: str, generation_id: str, api_key: str) -> None:
    global _workers_started
    if not generation_id.startswith("gen-") or not api_key:
        return
    with _workers_lock:
        if not _workers_started:
            # Metadata lookups must never delay model execution or app shutdown.
            # The generation ID and estimate are durable before work is queued.
            for index in range(2):
                threading.Thread(target=_worker, name=f"usage-cost-{index}", daemon=True).start()
            _workers_started = True
    with _condition:
        if call_id in _active_calls or len(_active_calls) >= _MAX_PENDING:
            return
        _active_calls.add(call_id)
        heapq.heappush(_pending, (time.monotonic(), next(_sequence), call_id, generation_id, api_key, 0))
        _condition.notify_all()
