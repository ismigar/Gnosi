"""Tests for the deterministic project-planning engine."""

from backend.services.planning_engine import build_schedule, normalize_period


CALENDAR = {"working_weekdays": [1, 2, 3, 4, 5], "hours_per_day": 8, "holidays": []}


def task(task_id, period, **extra):
    return {"id": task_id, "title": task_id, "period": period, **extra}


def test_legacy_predecessor_is_lazily_migrated_to_fs_dependency():
    period = normalize_period({"predecessorIds": ["a"]})
    assert period["version"] == 3
    assert period["dependencies"] == [{"predecessorId": "a", "type": "FS", "lagMinutes": 0.0}]


def test_all_dependency_types_and_working_lag_are_scheduled():
    schedule = build_schedule([
        task("a", {"start": "2026-07-27T09:00", "durationDays": 1, "startMode": "manual"}),
        task("b", {"durationDays": 1, "dependencies": [{"predecessorId": "a", "type": "FS", "lagMinutes": 480}]}),
        task("c", {"durationDays": 1, "dependencies": [{"predecessorId": "a", "type": "SS", "lagMinutes": 0}]}),
    ], CALENDAR, status_date="2026-07-01T09:00")
    results = {item["id"]: item for item in schedule["tasks"]}
    assert results["a"]["end"] == "2026-07-27T17:00"
    assert results["b"]["start"] == "2026-07-28T17:00"
    assert results["c"]["start"] == "2026-07-27T09:00"


def test_cycles_and_deadlines_are_reported_without_overwriting_task_facts():
    schedule = build_schedule([
        task("a", {"durationDays": 1, "dependencies": [{"predecessorId": "b"}], "deadline": "2026-01-01T09:00"}),
        task("b", {"durationDays": 1, "dependencies": [{"predecessorId": "a"}]}),
    ], CALENDAR, status_date="2026-07-01T09:00")
    assert schedule["cycles"] == [["a", "b"]]
    assert schedule["diagnostics"][0]["code"] == "dependency_cycle"


def test_manual_boundary_is_preserved_and_critical_path_is_exposed():
    schedule = build_schedule([
        task("a", {"start": "2026-07-27T09:00", "durationDays": 1, "startMode": "manual"}),
        task("b", {"durationDays": 2, "dependencies": [{"predecessorId": "a"}]}),
    ], CALENDAR, status_date="2026-07-01T09:00")
    results = {item["id"]: item for item in schedule["tasks"]}
    assert results["a"]["start"] == "2026-07-27T09:00"
    assert results["b"]["id"] in schedule["criticalTaskIds"]


def test_actual_boundaries_freeze_completed_task_schedule():
    schedule = build_schedule([
        task("a", {"durationDays": 4, "actualStart": "2026-07-27T09:00", "actualEnd": "2026-07-27T12:00", "percentComplete": 100}),
    ], CALENDAR, status_date="2026-08-01T09:00")
    assert schedule["tasks"][0]["start"] == "2026-07-27T09:00"
    assert schedule["tasks"][0]["end"] == "2026-07-27T12:00"


def test_backward_pass_calculates_slack_for_parallel_paths():
    schedule = build_schedule([
        task("long", {"start": "2026-07-27T09:00", "durationDays": 3, "startMode": "manual"}),
        task("short", {"start": "2026-07-27T09:00", "durationDays": 1, "startMode": "manual"}),
    ], CALENDAR)
    results = {item["id"]: item for item in schedule["tasks"]}
    assert results["long"]["freeSlackMinutes"] == 0
    assert results["short"]["freeSlackMinutes"] > 0
    assert results["short"]["lateEnd"] == results["long"]["end"]


def test_external_predecessors_are_used_without_becoming_project_tasks():
    schedule = build_schedule([task("local", {"durationDays": 1, "dependencies": [{"predecessorId": "external"}]})], CALENDAR, status_date="2026-07-01T09:00", external_facts=[task("external", {"start": "2026-07-27T09:00", "durationDays": 1, "startMode": "manual"})])
    assert [item["id"] for item in schedule["tasks"]] == ["local"]
    assert schedule["tasks"][0]["start"] == "2026-07-27T17:00"
    assert not any(item["code"] == "external_dependency" for item in schedule["diagnostics"])
