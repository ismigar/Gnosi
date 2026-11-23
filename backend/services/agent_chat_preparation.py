"""Exclusive monotonic timings for the serial admission stages of one chat turn."""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager, nullcontext
from contextvars import ContextVar
from dataclasses import dataclass
from itertools import pairwise
from time import monotonic
from typing import Literal, ParamSpec, TypeVar

Stage = Literal["session", "configuration", "vault_context", "connectors", "capabilities", "team", "workflow"]
P = ParamSpec("P")
T = TypeVar("T")


@dataclass(slots=True)
class _Span:
    stage: str
    start: float
    end: float | None = None


class ChatPreparation:
    def __init__(self, started_at: float) -> None:
        self._started_at = started_at
        self._spans: list[_Span] = []
        self._result: dict[str, int] | None = None

    def record(self, name: str, start: float, end: float) -> None:
        self._spans.append(_Span(name, start, end))

    @contextmanager
    def stage(self, name: Stage) -> Iterator[None]:
        span = _Span(name, monotonic())
        self._spans.append(span)
        try:
            yield
        finally:
            span.end = monotonic()

    def finish(self, end: float) -> dict[str, int]:
        if self._result is not None:
            return self._result
        # At each boundary charge elapsed wall time to the innermost active
        # stage. A worker can still be finishing when a request is cancelled.
        start = self._started_at
        spans = sorted(
            ((span.start, min(span.end if span.end is not None else end, end), span.stage)
             for span in self._spans if span.start < end),
            key=lambda span: (-span[0], span[1]),
        )
        boundaries = sorted({start, end, *(point for left, right, _ in spans for point in (left, right))})
        durations = dict.fromkeys((name for _, _, name in spans), 0)
        durations["other"] = 0
        for left, right in pairwise(boundaries):
            stage = next((name for opened, closed, name in spans if opened <= left and right <= closed), "other")
            # Rounding offsets keeps the partition equal to the legacy setup_ms.
            durations[stage] += int((right - start) * 1000) - int((left - start) * 1000)
        self._result = durations
        self._spans.clear()
        return durations


current_preparation: ContextVar[ChatPreparation | None] = ContextVar("chat_preparation", default=None)


def preparation_stage(name: Stage) -> AbstractContextManager[None]:
    timing = current_preparation.get()
    return timing.stage(name) if timing is not None else nullcontext()


async def preparation_worker(
    name: Stage, function: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs,
) -> T:
    timing = current_preparation.get()
    if timing is None:
        return await asyncio.to_thread(function, *args, **kwargs)

    entered: float | None = None
    completed: float | None = None

    def work() -> T:
        nonlocal entered, completed
        entered = monotonic()
        try:
            return function(*args, **kwargs)
        finally:
            completed = monotonic()

    with timing.stage(name):
        queued = monotonic()
        try:
            return await asyncio.to_thread(work)
        finally:
            resumed = monotonic()
            timing.record("worker_queue", queued, entered if entered is not None else resumed)
            if completed is not None:
                timing.record("event_loop", completed, resumed)
