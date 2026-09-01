"""Provider-neutral notification channels for local Gnosi operations."""

from __future__ import annotations

import subprocess
from abc import ABC, abstractmethod
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path

from backend.config.data_dir import resolve_data_dir
from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_session
from backend.models.notification import Notification

log = get_logger(__name__)

_NOTIFICATION_HEADER = (
    "# Gnosi System Notifications\n\n"
    "| Timestamp | Level | Title | Message |\n"
    "| --- | --- | --- | --- |\n"
)


class BaseNotificationChannel(ABC):
    """Deliver one notification through a concrete local channel."""

    @abstractmethod
    def send(
        self,
        title: str,
        message: str,
        level: str = "INFO",
        workspace_id: str = "default",
    ) -> bool:
        """Return whether the channel accepted the notification."""


class DBChannel(BaseNotificationChannel):
    """Persist notifications in the management database."""

    def send(
        self,
        title: str,
        message: str,
        level: str = "INFO",
        workspace_id: str = "default",
    ) -> bool:
        db = get_mgmt_session()
        try:
            db.add(
                Notification(
                    workspace_id=workspace_id,
                    title=title,
                    message=message,
                    level=level,
                )
            )
            db.commit()
            return True
        except Exception as error:  # noqa: BLE001 - channel failures are isolated
            log.error("Failed to save notification to DB: %s", error)
            db.rollback()
            return False
        finally:
            db.close()


class MDChannel(BaseNotificationChannel):
    """Append operational notifications below the per-device data root."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self._data_dir = data_dir
        self.log_file: Path | None = None
        self._initialized = False

    def _init_paths(self) -> None:
        if self._initialized:
            return
        try:
            local_data = self._data_dir or resolve_data_dir(create=True)
            self.log_file = local_data / "logs" / "notifications.md"
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            if not self.log_file.exists():
                self.log_file.write_text(_NOTIFICATION_HEADER, encoding="utf-8")
            self._initialized = True
        except OSError as error:
            log.error("Failed to initialize Markdown notification channel: %s", error)

    def send(
        self,
        title: str,
        message: str,
        level: str = "INFO",
        workspace_id: str = "default",
    ) -> bool:
        self._init_paths()
        if self.log_file is None:
            return False

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        clean_message = message.replace("|", "\\|").replace("\n", " ")
        row = f"| {timestamp} | {level} | {title} | {clean_message} |\n"
        try:
            with self.log_file.open("a", encoding="utf-8") as handle:
                handle.write(row)
            return True
        except OSError as error:
            log.error("Failed to write notification to Markdown: %s", error)
            return False


class MacOSChannel(BaseNotificationChannel):
    """Deliver a best-effort native macOS notification."""

    def send(
        self,
        title: str,
        message: str,
        level: str = "INFO",
        workspace_id: str = "default",
    ) -> bool:
        clean_message = message.replace('"', '\\"')
        clean_title = title.replace('"', '\\"')
        command = f'display notification "{clean_message}" with title "{clean_title}"'
        try:
            subprocess.run(
                ["osascript", "-e", command],
                check=True,
                timeout=5,
            )
            return True
        except (OSError, subprocess.SubprocessError):
            return False


class NotificationDispatcher:
    """Fan out one event while isolating failures between channels."""

    def __init__(
        self,
        channels: Mapping[str, BaseNotificationChannel] | None = None,
    ) -> None:
        self.channels = (
            dict(channels)
            if channels is not None
            else {
                "db": DBChannel(),
                "md": MDChannel(),
                "os": MacOSChannel(),
            }
        )

    def notify(
        self,
        title: str,
        message: str,
        level: str = "INFO",
        workspace_id: str = "default",
    ) -> None:
        log.info("Broadcasting notification: %s [%s]", title, level)
        for name, channel in self.channels.items():
            try:
                channel.send(title, message, level, workspace_id)
            except Exception as error:  # noqa: BLE001 - one channel cannot block another
                log.error("Error in notification channel '%s': %s", name, error)


_dispatcher = NotificationDispatcher()


def notify(
    title: str,
    message: str,
    level: str = "INFO",
    workspace_id: str = "default",
) -> None:
    """Broadcast a notification through every configured local channel."""
    _dispatcher.notify(title, message, level, workspace_id)
