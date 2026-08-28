"""Characterization tests for provider-neutral notification channels."""

from __future__ import annotations

from pathlib import Path

from backend.platform import notifications


class _FakeSession:
    def __init__(self, *, fail_add: bool = False) -> None:
        self.fail_add = fail_add
        self.added: list[object] = []
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def add(self, value: object) -> None:
        if self.fail_add:
            raise RuntimeError("database unavailable")
        self.added.append(value)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


class _RecordingChannel(notifications.BaseNotificationChannel):
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, str, str, str]] = []

    def send(
        self,
        title: str,
        message: str,
        level: str = "INFO",
        workspace_id: str = "default",
    ) -> bool:
        self.calls.append((title, message, level, workspace_id))
        if self.fail:
            raise RuntimeError("channel unavailable")
        return True


def test_database_channel_commits_and_closes(monkeypatch) -> None:
    session = _FakeSession()
    monkeypatch.setattr(notifications, "get_mgmt_session", lambda: session)
    monkeypatch.setattr(notifications, "Notification", lambda **values: values)

    assert notifications.DBChannel().send("Title", "Body", "SUCCESS", "workspace-1")
    assert session.added == [
        {
            "workspace_id": "workspace-1",
            "title": "Title",
            "message": "Body",
            "level": "SUCCESS",
        }
    ]
    assert session.committed
    assert session.closed


def test_database_channel_rolls_back_and_closes(monkeypatch) -> None:
    session = _FakeSession(fail_add=True)
    monkeypatch.setattr(notifications, "get_mgmt_session", lambda: session)

    assert not notifications.DBChannel().send("Title", "Body")
    assert session.rolled_back
    assert session.closed


def test_markdown_channel_uses_local_data_and_initializes_once(tmp_path: Path) -> None:
    channel = notifications.MDChannel(data_dir=tmp_path)

    assert channel.send("First", "A | B\nC", level="WARNING")
    assert channel.send("Second", "Done", level="SUCCESS")

    path = tmp_path / "logs" / "notifications.md"
    content = path.read_text(encoding="utf-8")
    assert content.count("# Gnosi System Notifications") == 1
    assert "| WARNING | First | A \\| B C |" in content
    assert "| SUCCESS | Second | Done |" in content


def test_dispatcher_isolates_channel_failures() -> None:
    broken = _RecordingChannel(fail=True)
    healthy = _RecordingChannel()
    dispatcher = notifications.NotificationDispatcher({"broken": broken, "healthy": healthy})

    dispatcher.notify("Title", "Body", level="ERROR", workspace_id="workspace-2")

    expected = [("Title", "Body", "ERROR", "workspace-2")]
    assert broken.calls == expected
    assert healthy.calls == expected


def test_legacy_skill_import_points_to_canonical_boundary() -> None:
    from pipeline.skills.notification_service.scripts.notification_service import (
        notify as legacy_notify,
    )

    assert legacy_notify is notifications.notify
