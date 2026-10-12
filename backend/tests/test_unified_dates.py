"""Data preservation and scope isolation for the authorized task-date migration."""
from __future__ import annotations

import json
import tarfile

import pytest

from backend.services.unified_dates import formula_date_value, merge_dates, normalize_date, remap_scoped_date_references
from backend.services.planning_scheduler import _period_field
from backend.services.planning_engine import normalize_period
from backend.domains.vault.views.filters import apply_filter
from scripts.unify_task_dates import apply_migration, frontmatter, plan_migration, serialize


def test_date_and_open_period_are_distinct():
    assert normalize_date("2026-10-15")["kind"] == "point"
    assert normalize_date("2026-10-15/", "period")["kind"] == "period"
    assert normalize_date({"start": "2026-10-15T10:00", "end": "2026-10-17T18:00"})["withTime"]
    imported = normalize_period(normalize_date({"start": "2026-10-15T10:00", "end": "2026-10-17T18:00"}))
    assert imported["startMode"] == imported["endMode"] == "manual"
    assert imported["end"] == "2026-10-17T18:00"


def test_merge_keeps_copied_points_and_preserves_conflicting_planning_facts():
    assert merge_dates("2026-10-15", "2026-10-15")["kind"] == "point"
    period = {"start": "2026-10-15T10:00", "end": "2026-10-17T18:00", "durationDays": 3,
              "dependencies": [{"predecessorId": "parent", "type": "SS", "lagMinutes": 5}], "extension": 7}
    merged = merge_dates("2026-10-12", period)
    assert merged["legacyValues"]["Data"] == "2026-10-12"
    for key, value in period.items():
        assert merged[key] == value


def test_reference_rewrites_are_scoped_and_do_not_change_literal_filter_values():
    value = {"table_id": "other", "filters": [{"field": "Període", "value": "Període"}],
             "sections": [{"table_id": "tasks", "visibleProperties": ["Data", "Període"],
                            "filters": [{"field": "Període", "periodPart": "end", "value": "Període"}]}]}
    result = remap_scoped_date_references(value, "tasks", {"Període": "Data", "fld_old": "fld_date"})
    assert result["filters"] == value["filters"]
    section = result["sections"][0]
    assert section["visibleProperties"] == ["Data"]
    assert section["filters"] == [{"field": "Data", "periodPart": "end", "value": "Període"}]


def test_clocked_dates_match_day_filters_and_points_are_not_scheduled_as_periods():
    value = {"kind": "point", "start": "2026-10-15T18:00", "end": "2026-10-17T18:00", "durationDays": 2}
    assert apply_filter({"Data": value}, "task", {"field": "Data", "operator": "equals", "value": "2026-10-15"})
    assert apply_filter({"Data": value}, "task", {"field": "Data", "periodPart": "end", "operator": "equals", "value": "2026-10-15"})
    assert _period_field({"Data": value}) == ("Data", value)
    milestone = normalize_period(value)
    assert milestone["end"] == value["start"]
    assert milestone["durationDays"] == 0 and milestone["mode"] == "manual"
    assert formula_date_value({**value, "withTime": False}) == "2026-10-15"


def test_migration_backup_preserves_ids_bodies_clocks_and_references(tmp_path):
    vault = tmp_path / "vault"
    tasks = vault / "BD/Tasques"
    tasks.mkdir(parents=True)
    registry = {"tables": [{"id": "tasks", "name": "Tasques", "folder": "Tasques", "schema_revision": 8,
                            "properties": [{"id": "fld_date", "name": "Data", "type": "date"},
                                           {"id": "fld_period", "name": "Període", "type": "period", "predecessors_enabled": True}]}],
                "views": [{"table_id": "tasks", "visibleProperties": ["Data", "Període"], "dateField": "Període"},
                          {"table_id": "other", "dateField": "Període"}]}
    (vault / "BD/vault_db_registry.json").write_text(json.dumps(registry))
    metadata = {"id": "keep-id", "Data": {"start": "2026-10-15T10:00+02:00", "end": "2026-10-17T18:00+02:00"},
                "title": "keep title", "table_id": "tasks", "unrelated": {"nested": [1, 2]}}
    task = tasks / "existing.md"
    task.write_bytes(serialize(metadata, "\nText unchanged.\n\n![image](asset.png)\n"))
    original = task.read_bytes()
    changes, report = plan_migration(vault)
    assert report["period"] == 1 and report["conflicts"] == 0
    assert task.read_bytes() == original
    backup = tmp_path / "backup.tar.gz"
    apply_migration(vault, changes, report, backup)
    current, body = frontmatter(task.read_text())
    assert body == frontmatter(original.decode())[1]
    for key in ("id", "title", "table_id", "unrelated"):
        assert current[key] == metadata[key]
    assert current["Data"]["start"] == "2026-10-15T10:00+02:00"
    assert current["Data"]["end"] == "2026-10-17T18:00+02:00"
    with tarfile.open(backup) as archive:
        assert archive.extractfile("BD/Tasques/existing.md").read() == original
    after = json.loads((vault / "BD/vault_db_registry.json").read_text())
    assert after["tables"][0]["properties"][0]["id"] == "fld_date"
    assert after["tables"][0]["schema_revision"] == 9
    assert after["views"][0]["dateField"] == "Data"
    assert after["views"][0]["visibleProperties"] == ["Data"]
    assert after["views"][1]["dateField"] == "Període"
    assert plan_migration(vault)[1]["already_migrated"]


def test_migration_refuses_concurrent_edits_before_writing(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    path = vault / "task.md"
    path.write_bytes(b"new user edit")
    with pytest.raises(AssertionError, match="Vault changed"):
        apply_migration(vault, {"task.md": b"replacement"}, {"before_sha256": {"task.md": "wrong"}}, tmp_path / "backup.tar.gz")
    assert path.read_bytes() == b"new user edit"
