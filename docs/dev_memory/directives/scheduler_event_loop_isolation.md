# Scheduler event-loop isolation

## Objective

Keep HTTP handling responsive while scheduled feed, mail, calendar, social,
meeting-reminder and capability-automation work is slow or blocking.

## Procedure

1. Keep orchestration separate from execution. The scheduler clock may only
   identify due work and submit it; it must never execute a handler itself.
2. Run synchronous, CPU-bound and blocking-I/O handlers in a scheduler-owned,
   bounded worker pool. Do not use Starlette's shared background-task pool.
3. Permit at most one queued or running invocation per task name. A second
   tick or manual request is coalesced instead of creating a backlog.
4. Bound both workers and queue size. When saturated, leave the task due so a
   later scheduler tick can retry it.
5. Shutdown must stop the clock, reject new submissions, cancel queued work,
   release the process lock and wait only for a bounded interval for active
   daemon workers. An external provider must not hang application shutdown.
6. Test with local slow doubles only. Exercise an ASGI health request while
   scheduler work is blocked and prove the response remains prompt.

## Restrictions and edge cases

- Preserve task handlers, plugin gates, history, notifications and result
  semantics; isolation belongs around `run_task_now`, not inside providers.
- Note: do not call `run_task_now` from the scheduler clock, because it stalls
  all later ticks and couples bookkeeping/provider latency to orchestration.
  Submit it to the dedicated executor instead.
- Note: do not use FastAPI `BackgroundTasks` for manual scheduler runs, because
  it competes with ordinary HTTP sync dependencies in the application's shared
  thread pool. Submit to the scheduler-owned executor instead.
- Threads cannot safely be killed in Python. Shutdown therefore cancels queued
  work, signals active daemon workers and uses a bounded join; handlers should
  retain their own network timeouts.
- Note: use nominal work-item and stop-item types in the queue. Identity checks
  against an untyped `object()` sentinel do not narrow a strict union and can
  conceal unsafe tuple unpacking from mypy.
- Never use real accounts, vault data or external network calls in latency
  tests.

## Audited task paths

- `fetch_feeds` and newsletter ingestion are synchronous network/file work.
- `fetch_mail` covers both Gmail and IMAP synchronous providers.
- `fetch_calendar` is currently a compatibility no-op; live calendar reads are
  request-driven and are not scheduler work.
- scheduled social publication and capability automations create their own
  asyncio loop, now inside a scheduler worker rather than an HTTP worker.
- meeting reminders synchronously combine calendar reads, optional AI and
  notifications, also inside the same bounded scheduler pool.
- Every configured handler reaches these paths through the single
  `submit_task` boundary; no provider-specific executor is allowed to bypass
  its concurrency and duplicate controls.

## Verification

- Unit tests for concurrency limit, duplicate coalescing, saturation and
  bounded shutdown.
- ASGI regression test with slow scheduler doubles and a responsive health
  endpoint.
- Ruff, strict mypy and repository guardrails.

## Verified result

- With two shared HTTP worker slots occupied by legacy-style scheduled work, a
  trivial sync request waited 260.9 ms. With the same two slow jobs in the
  dedicated scheduler executor, the request waited 0.3 ms (99.9% less).
- The ASGI health request remained below the 200 ms regression bound while a
  local slow feed double was active.
- The full scheduler/API/lifespan selection passed without external network or
  user data.
