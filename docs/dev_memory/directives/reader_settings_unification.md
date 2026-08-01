# Reader Settings Unification

## Objective

Treat feed subscriptions and daily-podcast generation as two parts of the same
Reader configuration instead of exposing duplicate top-level Settings entries.

## Navigation

- Keep one `Reader` entry in the Settings `Connections` group.
- Remove the separate `Subscriptions` sidebar entry.
- Render `Daily podcast` and `Subscriptions` as internal section tabs using the
  same interaction and visual pattern as the AI settings sections.
- Keep `Daily podcast` as the default Reader section.
- Preserve compatibility for callers that open the legacy `newsletters`
  settings tab by routing them to `Reader → Subscriptions`.

## Component Pattern

- Use one reusable `SettingsSectionTabs` component for Settings pages with
  multiple peer sections.
- The component owns navigation semantics, active styling, icons, and
  `aria-current`; each settings domain owns only its section state and content.
- Reuse the existing AI section-tab CSS so Reader and AI remain visually
  consistent.

## Restrictions and Edge Cases

- Do not duplicate or move the subscription API and form state. Only change
  the navigation hierarchy and conditional rendering.
- Do not combine podcast model selection with feed-source persistence; they
  share a settings destination but remain independent data flows.
- Do not convert sequential form groups into tabs. Internal tabs are for peer
  sections that can be visited independently.
- Keep every new label in all four locale catalogs.

## Verification

1. Unit-test the shared tabs component, including selection and active state.
2. Verify there is one Reader sidebar item and no Subscriptions sidebar item.
3. Verify both Reader sections through browser DOM and visual inspection.
4. Confirm the existing podcast selection and subscription controls still
   render, then run i18n validation and the production frontend build.
