# Directive: Project planning period plugin

**Status:** Implemented and verified on 2026-07-25.

## Objective

Add an optional built-in `project-planning` plugin that turns a `period` field
into a scheduling value with four elements: start date and time, finish date
and time, duration in working days, and zero or more predecessors.

The field definition decides whether duration and predecessor controls are
enabled and whether duration calculations skip non-working time. Plugin
settings choose the projects table, tasks table, working weekdays, holidays,
hours per working day, and the start of the working day.

## Architecture decision

This is a built-in plugin, not a third-party iframe plugin. Scheduling changes
the native schema editor, cell editor, filters, calendar, timeline, and
serialization contract. The current third-party plugin API deliberately cannot
inject trusted React components into these surfaces.

Keep plugin activation and settings in `.gnosi/plugins.json`, using the
existing built-in plugin registry. Keep per-field behavior in the table
property configuration so two period fields in the same table may behave
differently.

Do not infer project or task tables from names. Persist immutable table IDs.
Field configuration must also continue using immutable field IDs and must
round-trip unknown configuration keys.

## Period value contract

New enhanced values use a versioned object containing `start`, `end`,
`durationDays`, and `predecessorIds`. Start and end are local ISO date-times
without a UTC suffix. Duration may be fractional and predecessors are page
IDs.

The object may additionally contain internal scheduling-origin flags for start
and finish. These distinguish a user-entered boundary from an automatically
calculated boundary, allowing a predecessor or duration change to recompute
only automatic values.

Legacy `YYYY-MM-DD/YYYY-MM-DD` strings remain readable everywhere. Editing a
legacy value with the enhanced plugin may migrate that one value to the
structured contract. Do not run an eager vault-wide migration.

Empty period values remain empty rather than producing a partially populated
object.

## Scheduling rules

One duration day equals the configured number of working hours. The default is
eight hours. The default work window begins at 09:00, and the default working
week is Monday through Friday.

When non-working time is skipped, weekends or other unselected weekdays and
the configured holiday dates have no available work window. When it is not
skipped, every weekday is available and holidays are ignored.

If start exists, finish is absent, and duration exists, calculate finish by
consuming working time from start.

If start is absent and predecessors exist, choose the latest valid predecessor
finish and normalize it forward to the next available working instant. Then
calculate finish from duration when possible.

If both boundaries are explicitly edited, derive duration from the working
time between them. Editing duration makes finish automatic. Editing a boundary
makes that boundary manual.

A zero-day duration is a milestone. Negative durations and inverted periods
are invalid.

Multiple predecessors use finish-to-start semantics in this version. The
latest predecessor controls the earliest start.

## Dependency integrity

Predecessor candidates come from the configured task table when one is set;
otherwise they come from the current table. The current task and every
transitive successor must be excluded to prevent cycles.

The enhanced period value is the source of truth for dependencies. Continue
reading legacy `predecessor_ids` metadata in the timeline, but new enhanced
edits must persist predecessors inside the period field.

Summary task dates continue to roll up from child minimum start and maximum
finish while preserving the parent period's structured metadata.

## User interface

Plugin settings must expose projects table, tasks table, working weekdays,
holiday dates, hours per day, and working-day start time.

The schema editor must expose duration, predecessors, and skip-non-working-time
switches only for period fields while the plugin is enabled.

The enhanced period editor must label all enabled elements and use
`datetime-local` controls. It must show predecessor titles, not raw IDs, while
persisting IDs.

Every user-visible string must be present in Catalan, English, Spanish, and
French locale files.

## Microsoft Project parity and follow-up architecture

The first version covers working calendars, finish-to-start dependencies,
summary spans, milestones through zero duration, and automatic successor
movement.

The product review must separately assess four dependency types with lead and
lag, constraints and deadlines, critical path and slack, baselines and
variance, progress and actual work, resources and assignments, resource
calendars and leveling, costs, recurrence, and fixed-duration/fixed-work/fixed-
units scheduling.

Critical path, leveling, and baselines must not be implemented as ad-hoc UI
formulas. They require an authoritative scheduling service, a dependency graph
with cycle diagnostics, explicit calendar entities, assignment entities, and
versioned schedule snapshots.

Before exposing native field editors to third-party plugins, add a declarative
field-contribution API with validated schemas, pure serializers, filter and
sort projections, migrations, and isolated UI rendering. Never grant a plugin
direct access to Gnosi's DOM.

## Restrictions and edge cases

- Do not convert local date-times through UTC; it shifts visible dates and
  times in positive-offset time zones.
- Do not calculate duration with raw elapsed milliseconds when non-working
  time must be skipped.
- Do not store predecessor titles; renames would break dependencies. Store IDs.
- Do not overwrite manual start or finish values during automatic scheduling.
- Do not allow a dependency edge that creates a direct or transitive cycle.
- Do not make table names or filesystem paths part of scheduling identity.
- Do not allow an empty working week. It leaves no valid instant for automatic
  scheduling, so the settings UI must retain at least one working weekday.
- Do not break filters, sorting, calendar rendering, summaries, clipboard
  output, or timeline rendering when a period value is structured.
- Do not stringify imported `{ start, end }` date ranges as
  `[object Object]`. Some Notion imports retain this shape on a field still
  declared as `date`; render its boundaries and edit from the start boundary.
- Do not treat the current third-party plugin sandbox as a native field
  extension API; it is intentionally isolated.

## Verification

Add pure unit tests for legacy parsing, structured parsing, working-day
addition, holidays, fractional duration, predecessor-derived starts,
milestones, and cycle prevention.

Add backend filter parity tests for structured period boundaries.

Run frontend unit tests, i18n validation, lint, and production build. Run the
relevant backend tests.

Use the native backend on port 5002 and frontend on port 5173 for browser QA.
Confirm plugin configuration, field configuration, four-element cell editing,
automatic finish, holiday skipping, predecessor-derived start, persistence,
and timeline rendering.

Verification completed:

- Frontend Vitest: 59 tests passed, including nine planning tests.
- Frontend production build and four-locale i18n validation passed.
- Backend structured-period snapshot/filter suite: 44 tests passed.
- Native browser QA confirmed the built-in plugin, project/task table
  selectors, working calendar controls, persistent settings, and all three
  period-field switches. The field-type preview was closed without changing
  the live table schema.
- Legacy structured date ranges no longer render as `[object Object]`.
