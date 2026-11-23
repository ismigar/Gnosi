"""Monotonic phase timings shared by the workers of a single chat request."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager, nullcontext
from contextvars import ContextVar
from threading import Lock
from time import monotonic
from typing import Literal

Phase = Literal["model", "tools"]
PhaseMetrics = dict[str, int | dict[str, int]]


class ChatTiming:
    def __init__(self, trace_id: str, request_started_at: float, workflow_ready_at: float, workflow_started_at: float,
                 setup_breakdown_ms: dict[str, int] | None = None) -> None:
        self.trace_id = trace_id
        self.request_started_at = request_started_at
        self.setup_ms = max(0, int((workflow_ready_at - request_started_at) * 1000))
        self.setup_breakdown_ms = setup_breakdown_ms
        self.workflow_started_at = workflow_started_at
        self._lock = Lock()
        self._in_flight = {"model": 0, "tools": 0}
        self._phase: Phase | None = None
        self._started_at = workflow_started_at
        self._intervals: list[tuple[Phase, float, float]] = []
        self.direct_reply_ms: int | None = None

    def _change(self, phase: Phase, delta: int) -> None:
        with self._lock:
            self._in_flight[phase] += delta
            if delta > 0:
                self.direct_reply_ms = None
            # Time with any model in flight counts once, even if another
            # worker is running a model or tool concurrently.
            active: Phase | None = None
            if self._in_flight["model"]:
                active = "model"
            elif self._in_flight["tools"]:
                active = "tools"
            if active != self._phase:
                now = monotonic()
                if self._phase is not None:
                    self._intervals.append((self._phase, self._started_at, now))
                self._phase, self._started_at = active, now

    @contextmanager
    def measure(self, phase: Phase) -> Iterator[None]:
        self._change(phase, 1)
        try:
            yield
        finally:
            self._change(phase, -1)

    def waits(self, start: float, end: float) -> dict[str, float]:
        with self._lock:
            intervals = list(self._intervals)
            if self._phase is not None:
                intervals.append((self._phase, self._started_at, end))
        elapsed = {"model": 0.0, "tools": 0.0}
        for phase, left, right in intervals:
            elapsed[phase] += max(0.0, min(end, right) - max(start, left)) * 1000
        return elapsed

    def phases(self, response_ms: int, total_ms: int) -> PhaseMetrics:
        # Routing ends when the answer is ready. Usage and checkpoint
        # work after that point belong to other_ms, even if accounting fails.
        workflow_offset_ms = int((self.workflow_started_at - self.request_started_at) * 1000)
        workflow_ms = max(0, response_ms - workflow_offset_ms)
        response_at = self.request_started_at + response_ms / 1000
        elapsed = self.waits(self.workflow_started_at, response_at)
        model_ms = min(workflow_ms, int(elapsed["model"]))
        tools_ms = min(workflow_ms - model_ms, int(elapsed["tools"]))
        return {"setup_ms": self.setup_ms, **({"setup_breakdown_ms": self.setup_breakdown_ms} if self.setup_breakdown_ms is not None else {}),
                "routing_ms": workflow_ms - model_ms - tools_ms, "model_ms": model_ms,
                "tools_ms": tools_ms, "other_ms": max(0, total_ms - self.setup_ms - workflow_ms)}

    def checkpoint_reply(self) -> PhaseMetrics:
        ready_ms = max(0, int((monotonic() - self.request_started_at) * 1000))
        self.direct_reply_ms = ready_ms
        return {"response_ms": ready_ms, "total_ms": ready_ms, **self.phases(ready_ms, ready_ms)}


current_chat_timing: ContextVar[ChatTiming | None] = ContextVar("chat_timing", default=None)


def root_reply_timings(trace_id: str | None) -> PhaseMetrics | None:
    """Stamp an approved root chat reply before the graph checkpoints its messages."""
    timing = current_chat_timing.get()
    return timing.checkpoint_reply() if timing is not None and timing.trace_id == trace_id else None


@contextmanager
def track_chat(trace_id: str, request_started_at: float, workflow_ready_at: float, workflow_started_at: float,
               setup_breakdown_ms: dict[str, int] | None = None) -> Iterator[ChatTiming]:
    timing = ChatTiming(trace_id, request_started_at, workflow_ready_at, workflow_started_at, setup_breakdown_ms)
    token = current_chat_timing.set(timing)
    try:
        yield timing
    finally:
        current_chat_timing.reset(token)


def chat_wait(phase: Phase) -> AbstractContextManager[None]:
    timing = current_chat_timing.get()
    return timing.measure(phase) if timing is not None else nullcontext()
