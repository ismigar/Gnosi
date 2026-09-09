"""Reminder reads use fresh local paths without preparing cloud/config folders."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.config import app_config
from backend.services import meeting_reminders as reminders


def test_reads_keep_local_state_without_loading_config_or_creating_directories(tmp_path, monkeypatch):
    root = tmp_path / "local"
    state_path = root / "system" / "meeting_reminders.json"
    state_path.parent.mkdir(parents=True)
    now = datetime(2026, 9, 8, 9, tzinfo=timezone.utc)
    state_path.write_text(json.dumps({
        "settings": {"enabled": True, "lead_minutes": 12}, "notified": {"preserved": "value"},
        "active": [{"id": "meeting", "start": (now + timedelta(minutes=4)).isoformat()}],
    }))
    original = state_path.read_bytes()
    monkeypatch.setenv("GNOSI_DATA_DIR", str(root))

    def forbidden(*args, **kwargs):
        raise AssertionError("A reminder read must not load vault config or create directories")

    monkeypatch.setattr(app_config, "load_params", forbidden)
    monkeypatch.setattr(Path, "mkdir", forbidden)
    assert reminders.get_settings() == {"enabled": True, "lead_minutes": 12}
    active = reminders.get_active(now)
    assert active[0]["id"] == "meeting" and active[0]["minutes_until"] == 4
    assert state_path.read_bytes() == original


def test_missing_local_state_is_not_created_until_a_write(tmp_path, monkeypatch):
    root = tmp_path / "missing-local"
    monkeypatch.setenv("GNOSI_DATA_DIR", str(root))
    assert reminders.get_active() == []
    assert reminders.get_settings() == reminders.DEFAULT_SETTINGS
    assert not root.exists()
    reminders.update_settings({"enabled": True, "lead_minutes": 7})
    stored = json.loads((root / "system" / "meeting_reminders.json").read_text())
    assert stored["settings"] == {"enabled": True, "lead_minutes": 7}
    assert stored["active"] == [] and stored["notified"] == {}


def test_switching_data_root_reads_its_own_fresh_state(tmp_path, monkeypatch):
    for name, lead_minutes in (("first", 4), ("second", 9)):
        root = tmp_path / name
        path = root / "system" / "meeting_reminders.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"settings": {"enabled": True, "lead_minutes": lead_minutes}}))
        monkeypatch.setenv("GNOSI_DATA_DIR", str(root))
        assert reminders._state_path() == path
        assert reminders.get_settings()["lead_minutes"] == lead_minutes
