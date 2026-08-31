---
name: scheduler
description: Maintain Gnosi's backend scheduler lifecycle, persistence and task dispatch. Use for scheduler startup or task-state regressions, not private development-agent orchestration.
---

# SKILL: Backend Background Scheduler

This skill defines the technical protocol for managing the Gnosi background task orchestrator (`SchedulerManager`).

> ID: SCHEDULER-CORE-20260408
> Core Logic: `backend/scheduler/manager.py`
> Status: ACTIVE

---

## 1. Objectives and Scope
- **Main Objective**: Maintain a stable and efficient background loop for orchestrating Reader flows and maintenance tasks.
- **Success Criteria**:
    - Tasks execute at their defined intervals.
    - Errors in one task do not stop the main scheduler loop.
    - Task state (last run, results) is persisted correctly.

---

## 2. Core Principles

### A. Background Loop
Construction loads configuration but does not start the thread. The application
lifespan calls `start()` unless `GNOSI_DISABLE_SCHEDULER` disables it. The daemon
loop checks enabled tasks every 60 seconds using `last_run` and
`interval_minutes`; do not describe a separate persisted `next_run` timer.

### B. Non-blocking Execution
The scheduler loop is outside the HTTP event loop. `run_task_now()` executes its
handler synchronously in its caller; individual domain jobs may start their own
workers. Do not assume every task gets another thread or promise concurrent
execution from this manager. Preserve domain-specific overlap and job policies.

### C. State Persistence
The configured `SCHEDULER` path holds task definitions and lifecycle metadata.
A per-device recovery mirror lives at
`GNOSI_DATA_DIR/system/scheduler_config.local.json`; the manager resolves it
through the canonical `LOCAL_DATA` path mapping. Execution history uses the
management database. Preserve both configuration sources when investigating a
cloud-placeholder read failure; do not replace an unreadable file with defaults.

---

## 3. Operations and CLI

### Manual Trigger
Tasks can be triggered manually via the REST API, bypassing the scheduled wait:
```bash
# A Personal Access Token is required once the backend runs with
# GNOSI_REQUIRE_AUTH (create one in Settings). Without enforcement it is optional.
curl -X POST http://localhost:5002/api/schedulers/{task_name}/run \
  -H "Authorization: Bearer $GNOSI_API_TOKEN"
```

---

## 4. Restrictions and Edge Cases

- **Daemon State**: Keep startup/shutdown in the app lifespan. Unit tests must not start the scheduler or fire overdue integrations.
- **Config Integrity**: Preserve configured paths and the recovery mirror. Missing tasks may be merged from defaults; unreadable configuration is not evidence that persisted user settings were empty.
- **Path Sensitivity**: Background tasks must use absolute paths (via `paths_config.py`) to avoid resolution errors when running as a service.
- **Host lock**: `start()` uses a local POSIX file lock when available; it is not a distributed multi-host lock. Preserve the non-POSIX fallback behavior.
- **Verification**: Run `backend/tests/test_scheduler_maintenance_scope.py`; its isolated child also selects the task-handler domain contracts before any backend configuration import. Use synthetic scheduler API and lifespan fixtures. Manual API execution is a real operation, not a documentation check.

---

## 5. Learning Cycle (Live Memory)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-04-07 | Idle Scheduler | Missing loop implementation | Refactored `SchedulerManager` to include an active `while` loop and thread spawning. |
| 2026-04-08 | Doc Displacement | Fragmentation | Moved directive from local `docs/` to consolidated `Skill`. |
