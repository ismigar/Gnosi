# Directive: Vault I/O in async handlers

## Symptom

Opening Calendar, Reader, or Graph never finishes, and every later API request
times out even for trivial endpoints. The backend remains healthy and does not
restart.

## Cause

An `async def` handler performs blocking filesystem I/O directly on the event
loop, commonly `vault_path.rglob("*.md")` plus `read_text()` over thousands of
OneDrive files. Online-only placeholders can take seconds to materialize or
raise `Errno 35`. While a synchronous read runs on the event loop, every
coroutine is blocked.

The 2026-06-01 incident came from `GET /api/calendar/events`, where
`_get_vault_events` scanned 11,690 Markdown files. Reader and Graph appeared
broken only because Calendar had blocked their shared event loop.

## Rules

1. Wrap blocking vault work with `await asyncio.to_thread(fn, ...)`. Never call
   `rglob`, `read_text`, or `open` directly from an async handler.
2. Do not scan the complete vault. Exclude large or irrelevant directories
   such as `Mail`, `Images`, `Assets`, `.git`, `.gnosi`, and `node_modules`.
   Reuse `get_markdown_files_efficient()` or a pruned directory walk.
3. Skip online-only files before reading:
   `if getattr(path.stat(), "st_blocks", 1) == 0: continue`. Proactive and
   on-demand warmup handle materialization.
4. Run Google, CalDAV, and IMAP blocking clients in worker threads with
   explicit timeouts.

## Diagnosis

Compare direct backend and Vite-proxy response times. In native development,
inspect `~/Library/Logs/Gnosi/backend-native.{log,err}` and use `py-spy` on
the uvicorn worker when needed. For Docker deployments, inspect the worker
rather than the reload supervisor.

```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" \
  http://localhost:5002/api/<endpoint>
curl -sk -o /dev/null -w "%{http_code} %{time_total}s\n" \
  https://localhost:5173/api/<endpoint>
```

## Restrictions

- Playwright `networkidle` is unreliable with Vite because the HMR WebSocket
  stays active. Wait for meaningful DOM state.
- Operational databases live in `local_data`, not the Vault, and are not the
  OneDrive placeholder problem.
- Vault-backed calendar collection can still take seconds when reading
  thousands of local files. A future improvement should reuse the cached page
  index rather than opening every file.

Remember: blocking OneDrive I/O inside an async handler blocks the entire app.
Always combine `asyncio.to_thread`, directory pruning, and online-only checks.
