# Agent source settings

Attached sources retain their reference IDs and are unique by kind and reference. The settings picker treats the historical `database` kind as `table` for duplicate detection, without rewriting saved entries. Scope edits patch the original configuration; missing catalog entries remain visible and removable. Empty list filters retain their existing “all” semantics.

Source catalogs and folder requests are bound to the active Vault, workspace and user. Refresh and context changes discard stale responses. The shared selection control preserves the editor’s scalar and relation adapters and uses the modal dropdown layer in settings.

## Mail scope

`accounts` retains its existing behavior: an empty list uses the configured accounts. `folders_by_account` optionally maps normalized account addresses to nonempty arrays of exact folder identifiers. An account without an override uses the legacy `folder` value, or `INBOX`. Changing accounts preserves dormant folder overrides. Invalid overrides never silently widen the scope. No stored configuration migration is required.

Search returns folder-qualified `mail:v2:` identifiers, encoding a JSON tuple of account, folder and provider message ID as unpadded base64url. The aggregate result keeps the existing global limit and reports per-folder failures with `partial` and `errors`. An exact read checks both account and folder; IMAP reads the selected mailbox without a Vault fallback, and Microsoft reads verify current folder membership. Legacy `account::message` identifiers remain readable only when the account has one effective folder.

## Validation

Regression coverage includes source add/remove/exhaustion, translated searches, numeric and missing selections, stale response cancellation, folder selection persistence, duplicate provider IDs, partial mail failures and scoped reads. Browser verification uses synthetic catalogs at desktop and 390px widths in light and dark themes.

### Results — 2026-09-26

- 73 frontend regression tests and 75 backend source/contract tests passed; 22 Vite configuration tests passed separately.
- Frontend TypeScript, scoped ESLint, strict Python typing for the four affected adapter/service modules, Ruff, four-locale validation, generated API client validation, API boundary checks, production build and bundle budgets passed.
- Browser checks covered real rendered components with synthetic data, keyboard selection, accent-insensitive search, modal dropdown stacking and 390px layouts without horizontal overflow, in both themes.
- Existing baseline failures were reproduced at source commit `67e4f66a5`: two Reader analysis tests expect an obsolete prompt marker; frontend architecture checks flag `useModelComparisonData.ts`; backend source guardrails flag `directed_reading.py`, `agent_document_work.py`, `agent_skill_catalog.py` and `plugin_agent_profiles.py`. These files were not changed by this revision.
- No installed application or live account data was modified. Implementation is on the local `fix/agent-source-settings` branch, based on the installed application's recorded source revision.
