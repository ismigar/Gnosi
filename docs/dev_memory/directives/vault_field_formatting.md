# Vault Number, Currency, and Date Formatting

## Objective

Apply global locale defaults and optional per-field overrides to numbers,
currency, percentages, dates, datetimes, and periods.

Priority:

1. Field `config.format`.
2. Global settings.
3. Selected interface locale.

English is the default locale on a fresh installation.

## Data model

Global settings:

- Currency code/display setting.
- Decimal style.
- Week start.
- Date format: locale, day-first, month-first, or ISO.

Field format:

- Number: kind, decimals, optional currency.
- Date/datetime: optional date format.

Formatting changes presentation only. Numbers remain numeric and dates remain
ISO in storage.

## Pure helpers

`formatUtils.js` provides deterministic functions with explicit locale:

- Parse a three-letter currency code.
- Format number, currency, or percentage.
- Format date/datetime without accidental UTC day shifts.
- Merge field overrides over global settings.

Percentage values are stored as human percentages, so `25` renders as `25%`;
do not use an API that multiplies by 100.

Invalid inputs return the original value rather than `NaN` or an invalid-date
label.

## Settings hook

`useLocaleSettings` reads cached application config, derives locale and format
settings, and refreshes on `gnosi:config-changed`. Do not create a competing
localStorage source of truth.

## Rendering

- Format table cells and aggregations.
- Format page properties in display mode.
- Keep raw values in focused editors.
- Clipboard and grid coercion continue using raw values.

Avoid hard-coded locales in date components.

## UI

Global Settings exposes currency, decimal style, and date format. Schema
settings expose relevant controls by field type. Every label is localized in
all supported locale files.

## Restrictions

- Parse configured currency display strings to ISO codes before `Intl`.
- Decimal separators come from a suitable formatting locale; do not post-edit
  formatted strings.
- Never reformat while editing because it disrupts caret position and parsing.
- Explicit-format dates use local components to avoid timezone shifts.
- Unit tests pass explicit locales for deterministic output.

## QA

Unit-test number, currency, percentage, invalid values, every date format, and
timezone edges. Browser-test global changes, per-field overrides, live config
refresh, aggregations, and raw-value editing.
