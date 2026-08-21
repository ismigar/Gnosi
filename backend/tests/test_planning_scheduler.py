"""Integration coverage for coalesced Markdown schedule refreshes."""

import json

from backend.services.planning_scheduler import recalculate_vault


def test_scheduler_rebuilds_index_and_only_writes_automatic_boundaries(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_LOCAL_DATA", str(tmp_path / "local"))
    config = tmp_path / ".gnosi"
    config.mkdir()
    (config / "plugins.json").write_text(json.dumps({
        "schema_version": 2,
        "enabled_builtin": ["project-planning"],
        "enabled_third_party": [],
        "disabled": [],
        "settings": {"project-planning": {"task_table_id": "tasks"}},
        "granted": {},
    }), encoding="utf-8")
    task = tmp_path / "task.md"
    task.write_text("""---
id: task-1
title: Task
table_id: tasks
Window:
  version: 3
  start: 2026-07-27T09:00
  end: ''
  durationDays: 1
  startMode: manual
  endMode: automatic
  dependencies: []
---
Body
""", encoding="utf-8")

    recalculate_vault(tmp_path)

    text = task.read_text(encoding="utf-8")
    assert "end: 2026-07-27T17:00" in text
    index_files = list((tmp_path / "local" / "cache" / "planning").glob("*.json"))
    assert len(index_files) == 1


def test_scheduler_preserves_manual_boundaries(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_LOCAL_DATA", str(tmp_path / "local"))
    config = tmp_path / ".gnosi"
    config.mkdir()
    (config / "plugins.json").write_text(json.dumps({
        "schema_version": 2,
        "enabled_builtin": ["project-planning"],
        "enabled_third_party": [],
        "disabled": [],
        "settings": {"project-planning": {"task_table_id": "tasks"}},
        "granted": {},
    }), encoding="utf-8")
    task = tmp_path / "task.md"
    task.write_text("""---
id: task-1
title: Task
table_id: tasks
Window:
  version: 3
  start: 2026-07-27T09:00
  end: 2026-07-28T09:00
  durationDays: 1
  startMode: manual
  endMode: manual
---
Body
""", encoding="utf-8")

    recalculate_vault(tmp_path)

    assert "end: 2026-07-28T09:00" in task.read_text(encoding="utf-8")
