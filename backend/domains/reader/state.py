"""Shared state and limits for durable Reader analyses."""

from __future__ import annotations

import re
import threading
from typing import Dict

JOB_ID_RE = re.compile(r"^[a-f0-9]{32}$")


MAX_BATCH_CHARS = 36_000


MAX_REDUCE_CHARS = 48_000


MAX_GUIDANCE_CHARS = 2_000


RUNNING_STATES = {"queued", "snapshotting", "mapping", "reducing"}


TERMINAL_STATES = {"completed", "failed", "cancelled", "interrupted"}


DEFAULT_MAX_ATTEMPTS = 3


DEFAULT_RETRY_BASE_SECONDS = 2


DEFAULT_RETRY_MAX_SECONDS = 30


DEFAULT_MODEL_CALL_BUDGET = 64


_THREADS: Dict[str, threading.Thread] = {}


_RETRY_TIMERS: Dict[str, threading.Timer] = {}


_LOCK = threading.RLock()


class JobRetryBudgetError(RuntimeError):
    """Raised before a model call would exceed the persisted job budget."""
