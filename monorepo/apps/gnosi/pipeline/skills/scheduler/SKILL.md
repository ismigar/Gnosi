# SKILL: Backend Background Scheduler

This skill defines the technical protocol for managing the Gnosi background task orchestrator (`SchedulerManager`).

> ID: SCHEDULER-CORE-20260408
> Core Logic: `monorepo/apps/gnosi/backend/scheduler/manager.py`
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
The `SchedulerManager` initializes a daemon thread on instantiation. The loop wakes up every 60 seconds to evaluate if any enabled tasks have reached their `next_run` timestamp.

### B. Non-blocking Execution
When a task is triggered, it runs in a separate `threading.Thread`. This ensures that long-running tasks (like PDF generation) do not block the scheduler from starting other tasks.

### C. State Persistence
Task definitions and their lifecycle metadata (last run, next run, status) are stored in `data/scheduler_config.json`.

---

## 3. Operations and CLI

### Manual Trigger
Tasks can be triggered manually via the REST API, bypassing the scheduled wait:
```bash
curl -X POST http://localhost:5002/api/schedulers/{task_name}/run
```

---

## 4. Restrictions and Edge Cases

- **Daemon State**: Ensure `self.start()` is called during initialization to activate the `_scheduler_loop`.
- **Config Integrity**: The `data/` directory must be preserved. If `scheduler_config.json` is missing, the manager must safely merge missing tasks from the defaults.
- **Path Sensitivity**: Background tasks must use absolute paths (via `paths_config.py`) to avoid resolution errors when running as a service.

---

## 5. Learning Cycle (Live Memory)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-04-07 | Idle Scheduler | Missing loop implementation | Refactored `SchedulerManager` to include an active `while` loop and thread spawning. |
| 2026-04-08 | Doc Displacement | Fragmentation | Moved directive from local `docs/` to consolidated `Skill`. |
