"""Typed scheduler configuration contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import NotRequired, TypedDict


class TaskSpec(TypedDict):
    """Static metadata for a scheduler task."""

    description: str
    default_interval: float
    default_enabled: NotRequired[bool]
    quiet: NotRequired[bool]


@dataclass
class ScheduledTask:
    """Persisted runtime state for one scheduler task."""

    name: str
    description: str
    interval_minutes: float
    enabled: bool
    last_run: str | None = None
    next_run: str | None = None
    status: str = "idle"
