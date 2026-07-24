# Native Reader Module Architecture

> Historical architecture record.

## Objective

Ingest feeds and newsletters into a focused reading interface and optionally
generate a daily audio summary.

## Data

SQLite stores feed sources, downloaded articles, and read state.

## Services

- Feed ingestion parses subscribed feeds on demand or through the scheduler.
- Mail ingestion reads configured newsletter folders through the shared mail
  service.
- Audio summarization creates a bounded script through the configured AI
  provider and synthesizes an audio file.

Provider model names, free-tier limits, and quotas change over time; verify
them before modifying runtime configuration.

## Frontend

`ReaderDashboard.jsx` presents navigation, article list, focused content, and
podcast progress. All visible text uses i18n with English defaults.

## Restrictions

- Sanitize untrusted feed HTML.
- Offload blocking feed, mail, AI, and audio work.
- Bound prompt size and report omitted content.
- Never hard-code account passwords in shared environment files.
