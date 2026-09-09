"""Private opt-in timings for GET /calendar/calendars and /calendar/events.

Send ``X-Gnosi-Calendar-Timing: 1`` to receive ``Server-Timing``. Only the
fixed phase names below and elapsed milliseconds are emitted, never arguments,
account identities, paths, results or exception text. Nested/provider phases
are inclusive and concurrent calls are summed, so they must not be added to
``cal_total``. Timings end before response validation and exclude middleware.
For events only, also send ``X-Gnosi-Calendar-Profile: 1`` for a bounded local
stack profile; a completed file is identified by ``X-Gnosi-Request-Profile-Id``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from threading import Lock
from time import perf_counter
from typing import Literal, ParamSpec, TypeVar

from backend.utils.request_profile import RequestProfile, start_request_profile

Phase = Literal[
    "total", "queue", "integrations", "calendars", "events", "hidden_db",
    "vault_projection", "credentials", "service", "http",
]
_PHASES: tuple[Phase, ...] = (
    "total", "queue", "integrations", "calendars", "events", "hidden_db",
    "vault_projection", "credentials", "service", "http",
)
_P = ParamSpec("_P")
_T = TypeVar("_T")
_A = TypeVar("_A")


@dataclass
class CalendarTiming:
    _seconds: dict[Phase, float] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)
    _profile: RequestProfile | None = None
    profile_id: str | None = None

    def add(self, phase: Phase, seconds: float) -> None:
        with self._lock:
            self._seconds[phase] = self._seconds.get(phase, 0.0) + seconds

    def header(self) -> str:
        with self._lock:
            return ", ".join(
                f"cal_{phase};dur={self._seconds[phase] * 1000:.3f}"
                for phase in _PHASES if phase in self._seconds
            )


_CURRENT: ContextVar[CalendarTiming | None] = ContextVar("calendar_timing", default=None)


@contextmanager
def collect_calendar_timing(
    enabled: bool, *, profile: bool = False,
) -> Iterator[CalendarTiming | None]:
    timing = CalendarTiming() if enabled else None
    if timing is not None:
        timing._profile = start_request_profile(profile)
    token = _CURRENT.set(timing)
    try:
        with calendar_phase("total"):
            yield timing
    finally:
        _CURRENT.reset(token)
        if timing is not None and timing._profile is not None:
            timing.profile_id = timing._profile.stop()


@contextmanager
def calendar_phase(phase: Phase) -> Iterator[None]:
    timing = _CURRENT.get()
    if timing is None:
        yield
        return
    started = perf_counter()
    try:
        yield
    finally:
        timing.add(phase, perf_counter() - started)


async def calendar_to_thread(
    function: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs
) -> _T:
    timing = _CURRENT.get()
    if timing is None:
        return await asyncio.to_thread(function, *args, **kwargs)
    queued = perf_counter()

    def run() -> _T:
        timing.add("queue", perf_counter() - queued)
        if timing._profile is not None:
            return timing._profile.run(function, *args, **kwargs)
        return function(*args, **kwargs)

    return await asyncio.to_thread(run)


def calendar_worker_map(
    executor: ThreadPoolExecutor, function: Callable[[_A], _T], items: Sequence[_A]
) -> list[_T]:
    timing = _CURRENT.get()
    if timing is None:
        return list(executor.map(function, items))
    # Diagnostics must not propagate vault/auth ContextVars that the normal
    # executor does not inherit. Share only the locked timing accumulator.

    def run(item: _A) -> _T:
        token = _CURRENT.set(timing)
        try:
            if timing._profile is not None:
                return timing._profile.run(function, item)
            return function(item)
        finally:
            _CURRENT.reset(token)

    return list(executor.map(run, items))
