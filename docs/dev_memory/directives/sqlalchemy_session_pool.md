# SQLAlchemy Session and Pool Management

## Objective

Prevent FastAPI from exhausting its SQLAlchemy connection pool and returning
pool timeout errors under moderate concurrency.

## Root causes

- Default pool capacity was too small for request dependencies plus nested
  service sessions.
- Exception paths skipped `session.close()`.
- Stale connections were not preflighted or recycled.
- Failed request dependencies could return a transaction without rollback.
- Slow cloud I/O extended request lifetime and held connections longer.

## Engine configuration

Validated SQLite engines use:

- `pool_size=20`
- `max_overflow=30`
- `pool_pre_ping=True`
- `pool_recycle=1800`

Do not increase beyond the validated capacity without measuring file
descriptors, SQLite contention, and request concurrency.

## Session pattern

```python
session = SessionLocal()
try:
    ...
    session.commit()
except Exception:
    session.rollback()
    raise
finally:
    session.close()
```

FastAPI database dependencies roll back on exceptions and close in `finally`.
Background tasks create and close their own session after the request
dependency has ended.

Do not pass a request-scoped session into a background task.

## Restrictions

- Measure `pool_pre_ping` overhead before applying the same setting to remote
  databases.
- Do not rely on happy-path `close()`.
- Do not assume a context manager's commit semantics match a long operation;
  use the explicit lifecycle where transaction boundaries matter.
- Keep slow network and filesystem work outside database transaction scope
  whenever possible.

## QA

After a concurrent request burst, checked-out connections return to zero and
logs contain no pool-limit errors. Tests cover query failure, commit failure,
dependency exceptions, and background-task isolation.
