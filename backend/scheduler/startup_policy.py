"""Startup policy for automatic scheduler dispatch."""

from __future__ import annotations

import os
import threading


def startup_delay_seconds() -> float:
    """Return the non-negative automatic-dispatch grace period."""
    return max(
        0.0,
        float(os.getenv("GNOSI_SCHEDULER_STARTUP_DELAY_SECONDS", "30")),
    )


def wait_before_automatic_dispatch(stop_event: threading.Event) -> bool:
    """Wait interruptibly before overdue automatic jobs may start."""
    delay = startup_delay_seconds()
    return bool(delay and stop_event.wait(delay))


__all__ = ["startup_delay_seconds", "wait_before_automatic_dispatch"]
