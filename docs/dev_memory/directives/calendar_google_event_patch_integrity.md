# Directive: Google Calendar Event Patch Integrity

## Objective

Allow Gnosi to edit Google Calendar events without replacing provider-owned
fields that are not represented by the calendar form.

## Scope

- Google Calendar event edits through the Calendar sidebar.
- Ordinary events, recurring instances, and special event types such as
  birthdays.
- Preservation of the existing event time zone for date-time edits.

## Required behavior

- Read the existing event only when provider context is needed to normalize the
  requested change.
- Send Google a partial event patch containing only fields explicitly supported
  by the Gnosi form.
- Compare submitted values with the provider resource and omit unchanged fields;
  the autosave form submits its complete state even for a one-field edit.
- Never round-trip the complete event resource through a full update operation.
- Preserve provider-owned fields such as event type, birthday properties,
  recurrence, recurring-series identity, organizer data, and conference data.
- Keep the destination calendar identifier outside the event body.
- Convert external all-day ends from provider-exclusive storage to inclusive
  form values, then back to an exclusive end before writing.
- Update an expanded birthday occurrence through its recurring master event.

## Restrictions and edge cases

- Do not send an expanded recurring instance back through a full event update:
  expanded instances do not contain the master recurrence, and Google rejects
  birthday instances with an event-type restriction error. Use the partial
  patch endpoint instead.
- Do not invent or copy recurrence onto an individual occurrence: this can
  change series semantics. Leave recurrence untouched unless a dedicated
  recurrence workflow explicitly owns that change.
- Do not send location, description, or attendees for birthday events: Google
  permits only summary, reminders, color, and valid one-day all-day date changes
  for this event type.
- Do not send start or end changes for birthdays linked to Google Contacts or the
  user's own profile: their dates are managed by the source profile.
- Do not discard the original time zone when a local date-time lacks an offset:
  Google requires a time zone. Reuse the event time zone and fall back to the
  application default only when the event provides none.

## Verification

- Unit-test that a birthday occurrence is updated with a partial patch and that
  no full update call is made.
- Unit-test preservation of an existing event time zone for date-time changes.
- Run the calendar backend tests, frontend static build, and browser end-to-end
  edit flow.

## Learning record

| Date | Failure | Root cause | Correction |
| --- | --- | --- | --- |
| 2026-08-09 | Editing a birthday showed `Error desant` and returned HTTP 500 | Gnosi fetched an expanded birthday occurrence and sent the whole resource through Google `events.update`; the occurrence omitted the annual recurrence required by the `birthday` event type | Build a supported-field body and use Google `events.patch`, preserving recurrence and other provider-owned fields |
| 2026-08-09 | Saving the same birthday still failed first with an empty range and then with the recurrence restriction | The sidebar submitted an inclusive same-day end directly to Google's exclusive-end API, the calendar rendered external ends as inclusive, and birthday occurrences were patched instead of their master series | Normalize all-day boundaries at the provider edge, mark external ends as exclusive, patch the recurring master, and ignore date changes owned by Google Contacts |
