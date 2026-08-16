# Directive: signed_dates_and_period_units

## Objective

Allow Vault `date` and `period` properties to store and display historical BCE
dates, and let each period property select the timeline granularity: hours,
days, or years.

## Data contract

- A historical date uses signed ISO local form: `-0044-03-15`.
- Period boundaries retain the same signed ISO representation, in both legacy
  `start/end` strings and structured period objects.
- The period schema configuration stores `period_unit` as `hours`, `days`, or
  `years`; missing and invalid values resolve to `days` for compatibility.

## Execution and verification

1. Parse signed dates by explicitly setting the JavaScript year, because the
   native parser does not reliably accept signed four-digit years.
2. Do not send BCE values through native `date` or `datetime-local` controls;
   use textual signed ISO input instead.
3. Keep the signed ISO representation visible for BCE values, rather than
   relying on locale era formatting.
4. Build timeline ticks from the configured period unit. Year ticks must label
   negative years as BCE and must not rely on locale month formatting.
5. Validate i18n parity, frontend build, signed-date unit tests, and the live
   Vault screen.

## Restrictions and edge cases

- Do not use `new Date('-0044-03-15')`: browser support is inconsistent and it
  can silently produce an invalid date. Use the Vault date parser instead.
- Do not format BCE values only with `Intl.DateTimeFormat`: the output can use
  eras and different year numbering, obscuring the persisted negative date.
- Preserve the default period unit as days for existing schemas.
- Do not route a `period` property through the generic text input: render the
  structured period editor and pass the field configuration so duration and
  predecessor controls follow the schema.
- Scope predecessor candidates to the table of the note currently being edited,
  not the global planning table, and provide the same searchable multi-select
  interaction used by other multiple-value properties.
- The primary numeric period control represents its configured unit (hours,
  days, or years), never completion percentage. Store it compatibly as working
  days and convert at the editor boundary.
- Keep the exact displayed duration in `durationValue`/`durationUnit`; a year
  duration must use calendar-year arithmetic rather than treating 365 days as
  working days. Legacy `durationDays` remains as the scheduler compatibility
  field.
- Selecting a predecessor makes the start and finish automatic so both
  boundaries are recalculated from the dependency and the configured duration.
- Keep the visible duration control editable for active period planning even
  when an older schema carries `duration_enabled: false`; otherwise the UI
  advertises a value that cannot recalculate the finish.
