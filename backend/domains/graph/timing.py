"""Optional per-request graph timings, containing no vault or page content."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from time import perf_counter


@dataclass
class GraphTiming:
    phases: dict[str, float] = field(default_factory=dict)
    cache_hits: dict[str, bool] = field(default_factory=dict)

    def header(self, node_count: int) -> str:
        values = [f"{name};dur={seconds * 1000:.3f}" for name, seconds in self.phases.items()]
        values.extend(
            f'{name}_cache;desc="{"hit" if hit else "miss"}"'
            for name, hit in self.cache_hits.items()
        )
        values.append(f'nodes;desc="{node_count}"')
        return ", ".join(values)


_CURRENT_TIMING: ContextVar[GraphTiming | None] = ContextVar("graph_timing", default=None)


@contextmanager
def collect_graph_timing(enabled: bool) -> Iterator[GraphTiming | None]:
    timing = GraphTiming() if enabled else None
    token = _CURRENT_TIMING.set(timing)
    try:
        yield timing
    finally:
        _CURRENT_TIMING.reset(token)


@contextmanager
def graph_phase(name: str) -> Iterator[None]:
    timing = _CURRENT_TIMING.get()
    if timing is None:
        yield
        return
    started = perf_counter()
    try:
        yield
    finally:
        timing.phases[name] = timing.phases.get(name, 0) + perf_counter() - started


def graph_cache_hit(name: str, hit: bool) -> None:
    timing = _CURRENT_TIMING.get()
    if timing is not None:
        timing.cache_hits[name] = hit
