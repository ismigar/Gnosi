"""Optional scheduler notification boundary."""

from __future__ import annotations

from typing import Any, Callable, cast

_notify: Callable[..., Any] | None
try:
    from pipeline.skills.notification_service.scripts.notification_service import (
        notify as imported_notify,
    )

    _notify = cast(Callable[..., Any], imported_notify)
except ImportError:
    _notify = None


def notify(
    title: str,
    message: str,
    level: str = "INFO",
    workspace_id: str = "default",
) -> None:
    """Send a notification when the optional skill is available."""

    if _notify is not None:
        _notify(title, message, level=level, workspace_id=workspace_id)
