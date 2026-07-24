# Directive: AI editor content and meeting reminders

Two Notion-style AI features built on current Gnosi infrastructure.

## One-shot generation

Always use
`backend/agent/factory.py::generate_text(prompt, user_message="")`, which
returns `(text, model_label)`.

Do not use legacy `pipeline/ai_client.py::call_ai_with_fallback`. It expects
the old flat `model_url`/`model_name` provider format, while current
`ai_routes` and `ai_credentials` store `credential_ref` and `base_url`. The
legacy path fails with `Invalid URL 'None'`.

The modern path follows `get_default_llm` → `get_llm` →
`resolve_provider_api_key`, matching agents and Settings validation. It tries
the active agent, automatic model selection, and hybrid fallback. With no
available provider it raises `RuntimeError("No AI provider available")`.
Calls are intentionally uncached.

## Graceful degradation

- Provider validation uses `POST /api/ai/providers/{provider}/validate`.
  Invalid credentials must be re-entered in AI Settings.
- `POST /api/ai/generate` maps missing-provider errors to HTTP 503,
  authentication and API-key errors to an actionable 503, and remaining
  upstream errors to 502. Never return an unexplained 500.
- If meeting agenda generation fails, `_generate_agenda` returns an empty
  string and the reminder is still sent. Reminders never depend on AI.

## Editor endpoint

`POST /api/ai/generate` accepts
`{ prompt, context?, mode?, language? }`, where mode is `free`, `continue`,
`summarize`, `improve`, or `translate`. `_build_generation_prompt` creates the
mode-specific prompt and returns `{content, provider}`.

`AIGenerateModal.jsx` provides free prompting, preset actions, and a preview
before insertion. `BlockEditor.jsx` exposes the AI slash-command group through
i18n. Insert through `richMarkdownToBlocks`, then
`editor.insertBlocks(blocks, anchor, "after")`, followed by autosave.

## Meeting reminder engine

`backend/services/meeting_reminders.py::scan_and_notify`:

- scans meetings in `[now, now + lead]`;
- deduplicates by `id|start`;
- generates an optional agenda with `generate_text`;
- calls `notify()` for native macOS, database, and Markdown channels;
- persists state to
  `LOCAL_DATA/system/meeting_reminders.json` with `safe_write_json`.

Helpers recalculate `minutes_until`, prune expired or dismissed reminders,
dismiss entries, and manage settings.

`calendar_routes.py` exposes reminder list, dismissal, and settings endpoints.
Enabling reminders synchronizes the scheduler task, providing one source of
truth.

The scheduler runs `meeting_reminders` every minute with `quiet: true`.
`run_task_now` must suppress generic start/success/error notifications for
quiet tasks or macOS receives a bubble every minute.

`MacOSChannel` uses `osascript` in native mode. Docker deployments degrade to
database and Markdown channels without failing.

`MeetingReminderWatcher.jsx` polls globally every 60 seconds and shows a
countdown, collapsible agenda, calendar navigation, and dismissal. Calendar
settings expose the i18n-backed toggle and 5/10/15/30-minute lead time.

## Resilient event collection

Calendar API responses and reminders share
`calendar_routes.collect_all_events`. A stale Google token or one failing
account must not fail the complete request. Skip that account and continue
with other accounts and Vault events. The calendars response signals when
reconnection is required.

## QA

Verified on 2026-06-21:

- prompt construction, scanning, agenda generation, notification,
  deduplication, and dismissal;
- provider calls reached upstream authentication rather than failing in local
  routing;
- the generation endpoint degraded to 503 correctly;
- an expired Google account was skipped while Vault events remained;
- frontend build and lint passed;
- banner rendering, agenda expansion, dismissal, settings synchronization,
  and console cleanliness were checked in a worktree preview.
