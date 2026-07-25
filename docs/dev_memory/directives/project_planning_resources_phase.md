# Directive: Project planning — resources, assignments, and allocation

## Purpose

Extend the built-in `project-planning` plugin with the architectural foundation
needed for resource scheduling, without moving task facts out of Markdown.

## Scope of this delivery

1. Persist named work calendars, resources, and task assignments in a
   vault-scoped Gnosi metadata store.
2. Add a pure backend planning engine that validates records and derives
   assignment cost, work, allocation buckets, and over-allocation warnings.
3. Expose authenticated CRUD and read-only allocation endpoints.
4. Add a plugin settings UI to manage the resource pool and inspect allocation
   warnings. Task assignment editing is introduced through the same stable task
   IDs and is deliberately separate from Markdown field editing.
5. Keep automatic resource leveling as a non-mutating proposal only. Never
   reschedule tasks from a page PATCH request.

## Data ownership

- Markdown remains the source of task title, period, dependencies, and user
  fields.
- `.gnosi/project_planning.json` stores normalized, stable-ID planning
  entities: calendars, resources, and assignments.
- Derived allocation data is returned by the planning engine and is not
  persisted as editable task fields.
- A later append-only store will hold baselines, actual-work logs, and applied
  leveling decisions.

## Invariants

- Every ID is generated server-side and every reference is validated.
- Resource availability is a positive percentage; assignment units are in the
  range (0, 1000].
- Work, costs, and rates cannot be negative.
- A missing resource/calendar reference is a validation error, never silently
  ignored.
- A resource calendar overrides the project default only for that resource.
- Over-allocation is a warning, not an automatic write.
- All mutations are serialized per vault and written atomically.

## API surface

- `GET /api/planning/state`
- `POST|PATCH|DELETE /api/planning/resources`
- `POST|PATCH|DELETE /api/planning/calendars`
- `POST|PATCH|DELETE /api/planning/assignments`
- `GET /api/planning/allocation`

## Validation

1. Unit-test the pure engine for validation, cost derivation, calendar
   capacity, collision warnings, and no-data behavior.
2. API-test vault-scoped persistence and CRUD validation.
3. Build the frontend and validate all four locale files.
4. Confirm the plugin configuration UI can create a resource and show its
   allocation status in the native app.

## Restrictions and edge cases

- Do not persist calculated costs or allocation buckets in Markdown: they can
  go stale when calendar, rate, or assignment data changes; derive them from a
  single planning snapshot instead.
- Do not implement resource leveling as a side effect of edits: this makes
  schedule mutations unreviewable; return a warning/proposal first.
- Do not reuse calendar-event attendance as project resources: attendance has
  different ownership, availability, rate, and work semantics.
