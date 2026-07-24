# Directive: Database sessions in background services

**Status:** Staging
**Date:** 2026-04-09

## Problem

Scheduler and standalone services such as `feed_ingester.py` and
`mail_ingester.py` failed when importing `SessionLocal` from
`backend.data.db`. The database is now selected per active vault, so
`SessionLocal` is no longer a valid process-global variable.

## Standard pattern

Import dynamic context and engine helpers:

```python
from backend.services.context_vars import get_active_vault_path
from backend.data.db import get_engine_for_path
```

Resolve the session at execution time:

```python
vault_path = get_active_vault_path()
_, session_factory = get_engine_for_path(vault_path)
db = session_factory()
```

`get_active_vault_path()` falls back to default configuration when scheduler
execution has no request-scoped vault context.

## Restrictions

- Never import a global `SessionLocal` from `backend.data.db`.
- Ensure manual scripts run with the app root on `PYTHONPATH`.
- Always close the session in `finally`.

## Verification

1. Run the script with the application environment and native virtualenv.
2. Confirm there are no import errors.
3. Check `scheduler_config.json` for a successful task state.
