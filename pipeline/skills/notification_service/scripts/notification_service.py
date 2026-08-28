"""Compatibility facade for the canonical notification platform boundary."""

from backend.platform.notifications import (
    BaseNotificationChannel,
    DBChannel,
    MacOSChannel,
    MDChannel,
    NotificationDispatcher,
    notify,
)

__all__ = [
    "BaseNotificationChannel",
    "DBChannel",
    "MDChannel",
    "MacOSChannel",
    "NotificationDispatcher",
    "notify",
]
