# Scheduler Configuration Resilience

## Objective

Ensure scheduled tasks do not disappear or remain inactive after a machine has
been offline for days or weeks.

## Root causes

Operational state was stored in the cloud-synchronized vault:

- An online-only scheduler file could not be read.
- The error fallback overwrote the good file with disabled defaults.
- Two Macs produced synchronization conflicts.
- A scheduler `flock` inside OneDrive could remain effectively stuck after a
  process restart, preventing the loop from starting.

## Implemented policy

1. Save scheduler configuration to both the vault and a local mirror under
   `LOCAL_DATA/system/scheduler_config.local.json`.
2. Load in order: vault, local mirror, then in-memory defaults.
3. Retry transient vault reads with short backoff.
4. If an existing vault file is unreadable, enter degraded mode and do not
   overwrite it.
5. While degraded, defaults remain in memory only.
6. Store `.scheduler.lock` under local data, never in the cloud vault.

The local mirror is per instance and reliably readable. The vault copy remains
the synchronized user configuration when available.

## First-run recovery

If both the vault file and local mirror are unavailable, degraded mode starts
with disabled defaults without persisting them. Seed the mirror only from a
known-good backup, not from a newly imported scheduler object that may already
be degraded.

Back up and materialize the vault configuration before operational repair.

## Restrictions

- Never overwrite an existing but temporarily unreadable configuration.
- Never place process locks on OneDrive.
- Do not infer that an empty settings page means data loss until backend health
  and scheduler loop state are checked.
- Consider moving all scheduler configuration to local data if cross-device
  task execution becomes more harmful than useful.

## QA

1. Scheduler loop starts exactly once.
2. Enabled tasks survive restart.
3. An unreadable vault file loads the local mirror.
4. An unreadable file with no mirror does not get replaced.
5. Lock exists only under local data.
6. API lists expected tasks and reports meaningful English diagnostics.
