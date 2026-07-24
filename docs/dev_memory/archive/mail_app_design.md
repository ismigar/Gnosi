# Mail Application Design

> Historical design record.

## Objective

Provide a modern, fast mail experience integrated with Gnosi's vault and
durable mail synchronization.

## Inputs and outputs

- Mail records and account data from backend mail services.
- Vault Markdown records for indexed or archived messages.
- Read state, labels, folder changes, drafts, and message actions.

## Flow

1. Load a paginated or virtualized message list.
2. Filter by account, folder, label, and search.
3. Render the selected message safely.
4. Persist read, move, archive, and trash actions through the backend.

## Requirements

- Do not mutate Markdown only in browser state; refetch to prove persistence.
- Scale to thousands of messages.
- Treat attachments as contained resources.
- Route all visible text through i18n with English defaults.
- Follow the self-correction protocol when persistence and UI state diverge.
