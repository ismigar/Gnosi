# Project Planning Authoritative Engine

## Objective

Evolve Gnosi project planning from client-side period helpers into a backend-authoritative
planning service while retaining Markdown metadata as the editable source of task facts.
The rollout must remain compatible with legacy period fields and work in native and Docker
deployments.

## Data ownership

- Task title, editable period intent, dependency declarations, manual boundaries, progress and
  project membership remain in Markdown front matter.
- `.gnosi/project_planning.json` stores planning configuration: calendars, resources, rate
  histories, assignments, recurrence definitions and vault defaults.
- `.gnosi/project_planning_history.jsonl` is append-only and records baseline versions, worklog
  entries, corrections and accepted leveling decisions.
- The derived schedule index is reconstructible and stored below `GNOSI_LOCAL_DATA`; it contains
  calculated dates, critical-path data, costs, diagnostics, schedule revision and source ETags.

## Period v3 contract and migration

- Normalized periods expose `start`, `end`, `durationDays`, `startMode`, `endMode`,
  `dependencies`, `mode`, `constraintType`, `constraintDate` and `deadline`.
- A dependency has `predecessorId`, `type` (`FS`, `SS`, `FF`, `SF`) and `lagMinutes`.
- Legacy `predecessorIds` and singular `predecessorId` are read as zero-lag `FS` dependencies.
- Migration is lazy, deterministic and idempotent. It never rewrites manual period boundaries and
  does not persist calculated values to Markdown as independently authoritative facts.

## Scheduling rules

- The backend is the sole authority for automatic date calculation. It applies working calendars,
  dependency types, working lead/lag, constraints and actuals.
- Deadlines emit warnings only. Constraints are respected where feasible and otherwise emit a
  diagnostic with a trace.
- Automatic writes may update only a boundary explicitly marked automatic and must use the source
  page ETag/revision observed during calculation. A stale or manually changed page is skipped and
  reported as a conflict.
- Cross-project predecessors are read-only: their current schedule is input, never a target for
  writes by another project.

## Recalculation, review and audit

- Recalculations are coalesced per vault and project. A schedule revision and all source ETags
  accompany schedule responses, baseline captures and leveling proposals.
- Applying a proposal requires matching schedule revision and ETags. Otherwise the proposal is
  obsolete and must be regenerated.
- Baselines are immutable, named versions. Worklogs and their corrections are append-only.

## Delivery slices

1. Implement the pure calendar, dependency graph, constraints, CPM and cost engine with tests.
2. Add normalized persistence, migration, derived index, history and review-aware APIs.
3. Integrate automatic recalculation with page changes and expose calendars, resources,
   assignments, baselines, worklogs, recurrence and leveling APIs.
4. Extend period editing and provide a planning page for schedule, Gantt, diagnostics, resources,
   costs, baselines and leveling proposals.
5. Validate unit, migration, API and browser workflows; run frontend build, backend tests and
   native/Docker smoke checks without adding mode-specific paths or hosts.

## Restrictions and edge cases

- Do not overwrite manual dates or a changed page during automatic persistence; doing so loses
  deliberate user edits. Use ETag comparison and record a conflict instead.
- Do not treat deadlines as hard constraints; doing so incorrectly hides late schedule risk.
- Do not make derived schedule data a Markdown source of truth; rebuild it from task facts and
  planning state after corruption or migration.
- Do not use Docker-only URLs or native-only paths. Resolve writable data through the existing
  environment configuration.
- Do not mutate worklogs, baselines or decision history in place. Append a correction or version.
