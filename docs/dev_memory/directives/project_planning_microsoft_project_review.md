# Review: Microsoft Project capabilities for Gnosi planning

**Reviewed:** 2026-07-25 against current Microsoft Support documentation.

## Current Gnosi baseline

With the `project-planning` plugin, Gnosi has the beginning of a scheduling
model: local start and finish date-times, duration in working days, a per-vault
work calendar, finish-to-start predecessors, cycle prevention in the editor,
automatic successor movement in the timeline, summary spans for parent tasks,
and zero-duration milestones.

The current model remains intentionally lightweight. Markdown records are the
source of truth, table properties define the period behavior, and the plugin
configuration identifies the project and task tables.

## Capability comparison and priority

### Dependency types, lead, and lag

Microsoft Project supports finish-to-start, start-to-start, finish-to-finish,
and start-to-finish dependencies, plus positive lag and negative lead. Its
default is finish-to-start.

This is the highest-value next scheduling feature. The current
`predecessorIds` list would need to become a versioned list of dependency
objects containing predecessor ID, type, and lag expressed in working minutes
or a typed duration. A migration can interpret every current ID as
finish-to-start with zero lag.

This requires a central dependency-graph calculator but not a storage-system
replacement.

Sources:

- https://support.microsoft.com/en-US/project/link-tasks-in-a-project
- https://support.microsoft.com/en-us/project/change-a-task-link

### Constraints, deadlines, and manual versus automatic scheduling

Project combines dependencies with flexible and inflexible constraints such as
As Soon As Possible and Start No Earlier Than. It also treats actual start and
completed work as boundaries that automatic rescheduling must not move
backward.

Gnosi should add explicit constraint type/date, deadline, and scheduling mode
properties rather than infer constraints from a manually entered start. The
current internal manual/automatic boundary flags are sufficient for the first
plugin version but are not a complete constraint model.

This requires conflict diagnostics from an authoritative scheduling service.
The UI must be able to explain which dependency, calendar, actual, or
constraint controls a date.

Source:

- https://support.microsoft.com/en-US/project/link-tasks-in-a-project

### Critical path, total slack, and multiple critical paths

Project identifies the dependency chain that controls project finish and can
show tasks whose slack falls below a configurable threshold. It can also show
critical paths for independent networks.

Gnosi can implement critical path method calculations with forward and
backward graph passes once dependency types, lags, calendars, constraints, and
project boundaries are authoritative. Critical flags and slack are derived
data and should be cached, never stored as user-edited frontmatter.

This needs a rebuildable schedule index and invalidation on any task,
dependency, or calendar change. It does not require a new primary database.

Source:

- https://support.microsoft.com/en-US/project/show-the-critical-path-of-your-project-in-project

### Baselines, variance, and tracking Gantt

Project can keep up to eleven baseline snapshots and roll baseline data from
subtasks into summary tasks. Baselines make planned-versus-current variance
and slipped-task reporting possible.

Gnosi should store immutable, named project snapshots containing schedule
version, task IDs, planned dates, duration, work, cost, and capture time.
Duplicating baseline columns into every Markdown task would create schema
noise and make partial updates unsafe.

This requires an append-only baseline store under the vault's Gnosi metadata,
plus snapshot-aware reports. It is a moderate architectural addition.

Source:

- https://support.microsoft.com/en-US/project/set-and-save-a-baseline

### Progress, actuals, remaining work, and status date

Useful parity includes percent complete, actual start and finish, actual and
remaining work, status date, and schedule variance. Actuals must constrain
future rescheduling without rewriting history.

Gnosi can represent simple progress as task fields, but time-phased actual work
needs a separate append-only work-log entity. The existing derived progress
field can display results but must not become the source of truth.

This is a moderate change if progress is task-level and a larger one if
timesheets are included.

### Resources and assignments

Project separates resources from assignments. People, equipment, materials,
and cost resources can be assigned to tasks with units or availability.
Resource calendars can differ from the project calendar.

Gnosi needs normalized resource records and assignment records. A
multi-select people field is insufficient because each assignment needs units,
work, remaining work, rate, calendar, and possibly actuals.

This is a significant architectural change. Recommended entities are Resource,
Assignment, ResourceCalendar, and AvailabilityException, all referenced by
stable IDs.

Sources:

- https://support.microsoft.com/en-US/project/assign-people-to-work-on-tasks
- https://support.microsoft.com/en-us/project/add-resources-to-your-project

### Fixed duration, fixed work, fixed units, and effort-driven scheduling

Project relates effort, duration, and assignment units, and supports fixed
duration, fixed work, and fixed units modes. Effort-driven tasks redistribute
remaining work when resources are added.

This should follow, not precede, normalized assignments. The scheduler needs a
declared fixed variable, remaining-work rules, rounding policy, and audit
output explaining every recalculation.

This is a significant scheduling-engine change.

Sources:

- https://support.microsoft.com/en-us/project/scheduling-modes-in-microsoft-project-for-the-web
- https://support.microsoft.com/en-us/project/change-the-effort-driven-setting-for-task-types

### Resource over-allocation and leveling

Project can delay or split tasks to resolve resource over-allocation, using
dependencies, slack, dates, priorities, and constraints. It can level
automatically or on demand and preserve tasks that must not move.

Gnosi should first provide read-only allocation heat maps and conflict
warnings. Automatic leveling should be an explicit, reviewable command that
produces a proposed schedule diff before writing anything.

This requires the resource and assignment architecture, a scheduling
optimizer, cancellable background jobs, and an audit trail. It is a major
change and should not run synchronously inside page PATCH requests.

Sources:

- https://support.microsoft.com/en-US/project/resource-leveling-dialog-box
- https://support.microsoft.com/en-us/project/distribute-project-work-evenly-level-resource-assignments

### Costs and budgets

Project calculates assignment costs from standard and overtime rates, per-use
fees, fixed task costs, and cost resources. Rates may vary over time.

Simple fixed task or project budgets fit normal numeric/currency fields.
Resource-driven and time-phased cost requires rate tables, assignments,
effective dates, accrual rules, and actual-cost history.

This is a significant addition and should remain separated from accounting
records while supporting links to them.

Source:

- https://support.microsoft.com/en-us/project/enter-costs-for-resources

### Recurring tasks

Project creates daily, weekly, monthly, or yearly occurrences, allows a
different calendar, and can model recurring milestones with zero duration.

Gnosi already has recurrence primitives for calendar events. The reusable
recurrence rule can be extracted into a shared service, but task occurrences
must be stable records with origin IDs so edits, exceptions, dependencies, and
actuals do not collapse back into one template.

This is a moderate change and should reuse, not duplicate, calendar recurrence
logic.

Source:

- https://support.microsoft.com/en-us/project/create-recurring-tasks

### Multi-project dependencies and portfolios

Microsoft Project supports links across projects and resource pools shared by
multiple projects.

Gnosi already has globally stable page IDs inside a vault, so cross-project
task edges are possible. Scheduling them safely needs a workspace-level graph,
permission checks, stale-link diagnostics, and a clear policy for whether a
project can reschedule a task owned by another project.

This is a major governance and scheduling-boundary change.

## Recommended target architecture

### Authoritative planning service

Add a backend `PlanningEngine` that receives an immutable scheduling snapshot
and returns calculated dates, slack, criticality, warnings, and a change set.
The pure calendar and graph layers must be independently testable.

Page writes should enqueue or coalesce recalculation by project. The engine
should publish a versioned result and apply changes through normal page APIs
with optimistic concurrency. It must never recursively issue unbounded writes
from one HTTP request.

### Data ownership

Keep user-authored task facts in Markdown: duration, dependency declarations,
constraints, deadlines, progress, and resource assignments by stable ID.

Keep rebuildable derived results in a planning index: calculated dates,
criticality, slack, allocation buckets, and diagnostics.

Keep immutable history in append-only stores: baselines, actual work logs, and
leveling proposals or applied schedule changes.

Keep calendars as named reusable entities. Plugin-level defaults can seed the
first calendar, but project, task, and resource calendars need stable IDs and
exceptions once resource scheduling is introduced.

### Graph integrity and observability

Validate cycles on the backend as well as in the UI. Every calculated boundary
should carry a reason trace identifying the controlling calendar,
predecessor, lag, constraint, or actual.

Use schedule revision IDs so clients can tell whether visible dates and
derived diagnostics were calculated from the same graph version.

### Plugin architecture impact

The current project-planning feature can remain a built-in plugin without a
new plugin runtime. A third-party equivalent would require a declarative
field-extension API covering schema configuration, serializers, migrations,
filter and sort projections, validators, and isolated editors.

Do not solve this by granting third-party iframes direct DOM access. Native
field contributions need a validated host contract and versioned capability
negotiation.

## Recommended delivery sequence

1. Stabilize enhanced period values, calendars, finish-to-start dependencies,
   and timeline parity.
2. Add dependency objects with four link types plus lead and lag, backed by a
   server graph calculator and diagnostics.
3. Add constraints, deadlines, progress actuals, critical path, and slack.
4. Add immutable baselines and tracking-Gantt variance.
5. Add normalized resources, assignments, and resource calendars.
6. Add allocation views, then reviewable resource leveling.
7. Add time-phased work and cost only after assignments and actuals are stable.
8. Add cross-project scheduling after ownership and permission rules are
   explicit.

