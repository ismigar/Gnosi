"""
Scheduler Manager: Manages scheduled tasks using APScheduler.
"""

import json
import os
import threading
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TextIO, cast

from backend.config.app_config import load_params
from backend.data.management_db import get_mgmt_session
from backend.models.scheduler import TaskExecutionHistory
from backend.scheduler import task_handlers as scheduler_task_handlers
from backend.scheduler.contracts import ScheduledTask, TaskSpec
from backend.scheduler.notifications import notify


class SchedulerManager:
    """
    Manages scheduled background tasks.
    Uses a simple file-based persistence for task configurations.
    """

    AVAILABLE_TASKS: dict[str, TaskSpec] = {
        "fetch_feeds": {
            "description": "Fetch RSS/YouTube feeds",
            "default_interval": 120,  # 2 hours
        },
        "fetch_newsletters": {
            "description": "Fetch POP3 newsletters",
            "default_interval": 180,  # 3 hours
        },
        "generate_podcast": {
            "description": "Generate daily podcast from unread articles",
            "default_interval": 1440,  # 24 hours
        },
        "system_maintenance": {
            "description": "System maintenance (logs, mailbox, sandbox)",
            "default_interval": 1440,  # 24 hours
        },
        "llm_wiki_maintenance": {
            "description": "Rebuild LLM Wiki indexes and run deterministic checks",
            "default_interval": 1440,
            "quiet": True,
        },
        "academic_repository_sync": {
            "description": "Queue incremental academic repository synchronizations",
            "default_interval": 1440,
            "default_enabled": True,
            "quiet": True,
        },
        "academic_review_updates": {
            "description": "Queue due saved literature review searches",
            "default_interval": 1440,
            "default_enabled": True,
            "quiet": True,
        },
        "update_analytics": {
            "description": "Update statistics",
            "default_interval": 60,  # 1 hour
        },
        "suggest_connections": {
            "description": "Analyze connections between notes",
            "default_interval": 300,  # 5 hours
        },
        "fetch_calendar": {
            "description": "Calendar token verification",
            "default_interval": 60,  # 1 hour
        },
        "fetch_mail": {
            "description": "Mail synchronization (Gmail, IMAP)",
            "default_interval": 30,  # 30 minutes
        },
        "fetch_contacts": {
            "description": "Account synchronization (Google, CardDAV)",
            "default_interval": 1440,  # 24 hours
        },
        "update_memories": {
            "description": "General memory update (graph and connections)",
            "default_interval": 1440,  # 24 hours
        },
        "purge_trash": {
            "description": "Empty the Vault trash (entries older than 90 days)",
            "default_interval": 1440,  # 24 hours
        },
        "publish_scheduled_social": {
            "description": "Publish due scheduled social posts",
            "default_interval": 5,  # 5 minutes
        },
        "materialize_view_snapshots": {
            "description": "Materialize view snapshots into Markdown for portable migration",
            "default_interval": 1440,  # 24 hours
        },
        "meeting_reminders": {
            "description": "Upcoming meeting reminders with an AI agenda",
            "default_interval": 1,  # every minute
            # quiet: do NOT emit the "Task Started/Finished" notifications
            # (it would run every minute and flood macOS with bubbles). The alerts
            # for actual meetings are sent by the service itself.
            "quiet": True,
        },
        "run_capability_automations": {
            "description": "Run due governed capability automations",
            "default_interval": 1,
            "default_enabled": True,
            "quiet": True,
        },
    }

    TASK_PLUGIN_REQUIREMENTS: dict[str, tuple[str, ...]] = {
        "fetch_feeds": ("feeds-reader",),
        "fetch_newsletters": ("feeds-reader",),
        "generate_podcast": ("feeds-reader", "ai-platform"),
        "llm_wiki_maintenance": ("llm-wiki", "ai-platform"),
        "suggest_connections": ("ai-platform",),
        "fetch_calendar": ("calendar",),
        "fetch_mail": ("mail",),
        "fetch_contacts": ("contacts",),
        "update_memories": ("ai-platform",),
        "publish_scheduled_social": ("social-publishing",),
        "meeting_reminders": ("calendar", "ai-platform"),
        "run_capability_automations": ("automations", "ai-platform"),
    }

    def __init__(self) -> None:
        cfg = load_params(strict_env=False)
        self.config_path = cfg.paths.get("SCHEDULER")

        # Local mirror of scheduler_config: ALWAYS readable, immune to OneDrive
        # online-only. This is the safety net that prevents losing the config when
        # the vault file (.gnosi/) is dataless on startup. It lives at
        # local_data, like management.sqlite (see paths_config.py).
        local_data = cfg.paths.get("LOCAL_DATA")
        self.local_mirror_path = (
            local_data / "system" / "scheduler_config.local.json" if local_data else None
        )

        for p in (self.config_path, self.local_mirror_path):
            if p:
                try:
                    p.parent.mkdir(parents=True, exist_ok=True)
                except Exception:
                    pass

        self._tasks: dict[str, ScheduledTask] = {}
        self._running = False
        self._thread: threading.Thread | None = None
        self._lock_file: TextIO | None = None
        self._degraded = False  # True if we start up without being able to read any source

        self._load_config()

    @staticmethod
    def _try_read_tasks(path: Path | None) -> dict[str, Any] | None:
        """Reads and parses a task config file.

        Returns the dict {name: task_data} if the file exists, is readable, and
        contains tasks; None in any other case (nonexistent, empty,
        dataless/online-only, corrupt JSON). Retries a few times
        because OneDrive often serves an online-only file only on the 2nd attempt.

        """
        if not path or not path.exists():
            return None
        import time as _time

        for attempt in range(3):
            try:
                with open(path) as f:
                    data = json.load(f)
                tasks = data.get("tasks", {})
                return tasks or None  # Valid JSON but no tasks -> empty
            except Exception:
                _time.sleep(0.5 * (attempt + 1))  # short backoff for dataless
        return None

    def _reconcile_available_tasks(self) -> bool:
        """Removes obsolete tasks and adds new ones from AVAILABLE_TASKS.

        Returns True if any change occurred."""
        updated = False
        for task_name in list(self._tasks.keys()):
            if task_name not in self.AVAILABLE_TASKS:
                del self._tasks[task_name]
                updated = True
        for name, config in self.AVAILABLE_TASKS.items():
            if name not in self._tasks:
                self._tasks[name] = ScheduledTask(
                    name=name,
                    description=config["description"],
                    interval_minutes=config["default_interval"],
                    enabled=bool(config.get("default_enabled", False)),
                )
                updated = True
        return updated

    def _load_config(self) -> None:
        """Loads the scheduler config resiliently.

        Preference order:
          1. Vault file (`.gnosi/`, synced across machines).
          2. Local mirror (`local_data/`, always readable, immune to OneDrive).
          3. IN-MEMORY defaults — only if no source exists.

        CRITICAL: if the vault file EXISTS but currently cannot be read
        (online-only/dataless/corrupt), we NEVER initialize it with defaults or
        overwrite it. This way the user's config is never lost due to a
        transient OneDrive issue — previously, this was the path that used to empty the
        scheduler (see directive scheduler_config_resilience).

        """
        from backend.config.logger_config import get_logger

        log = get_logger(__name__)

        tasks = self._try_read_tasks(self.config_path)
        source = "vault"
        if tasks is None:
            tasks = self._try_read_tasks(self.local_mirror_path)
            source = "mirror local"

        if tasks is not None:
            for name, task_data in tasks.items():
                try:
                    self._tasks[name] = ScheduledTask(**task_data)
                except Exception:
                    pass  # ignores unknown keys / old formats
            self._reconcile_available_tasks()
            log.info(f"⏰ Scheduler: configuration loaded from {source} ({len(self._tasks)} tasks)")
            # We don't rewrite the vault at startup (avoids churn/conflicts from
            # OneDrive); we only refresh the local mirror with what we read.
            self._save_mirror()
            return

        # No readable source.
        vault_exists = bool(self.config_path and self.config_path.exists())
        mirror_exists = bool(self.local_mirror_path and self.local_mirror_path.exists())
        if vault_exists or mirror_exists:
            # The file exists but is currently unreadable. We do NOT touch it: we start up
            # in degraded mode with IN-MEMORY defaults (without persisting), so as not to
            # destroy the good config. It will recover on the next readable restart.
            log.error(
                "❌ Scheduler: the configuration file exists but is unreadable "
                "(online-only or corrupted). Degraded mode: using in-memory defaults; "
                "no file will be overwritten."
            )
            self._degraded = True
            self._init_default_tasks(persist=False)
        else:
            log.info("⏰ Scheduler: no configuration found; creating defaults.")
            self._init_default_tasks(persist=True)

    def _init_default_tasks(self, persist: bool = True) -> None:
        """Initialize with default tasks (all disabled).

        `persist=False` leaves the defaults in memory only — used in degraded
        mode to avoid overwriting an existing but unreadable file.

        """
        for name, config in self.AVAILABLE_TASKS.items():
            self._tasks[name] = ScheduledTask(
                name=name,
                description=config["description"],
                interval_minutes=config["default_interval"],
                enabled=bool(config.get("default_enabled", False)),
            )
        if persist:
            self._save_config()

    def _save_config(self) -> None:
        """Persists the config to the vault and ALWAYS to the local mirror.

        In degraded mode we do NOT write to the vault (we preserve the existing file
        that we currently cannot read), but we do write the local mirror so the current
        session doesn't lose the changes.

        """
        from backend.utils.safe_io import safe_write_json

        data = {"tasks": {name: asdict(task) for name, task in self._tasks.items()}}

        if self.config_path and not self._degraded:
            try:
                # Atomic write: the file is modified dozens of times per
                # task execution; a crash halfway through would leave the JSON corrupted.
                safe_write_json(self.config_path, data, indent=2)
            except Exception as e:
                from backend.config.logger_config import get_logger

                get_logger(__name__).error(
                    f"Failed to save scheduler config to {self.config_path}: {e}"
                )

        self._save_mirror(data)

    def _save_mirror(self, data: dict[str, Any] | None = None) -> None:
        """Writes the local mirror (always readable; immune to OneDrive)."""
        if not self.local_mirror_path:
            return
        if data is None:
            data = {"tasks": {name: asdict(task) for name, task in self._tasks.items()}}
        try:
            from backend.utils.safe_io import safe_write_json

            safe_write_json(self.local_mirror_path, data, indent=2)
        except Exception as e:
            from backend.config.logger_config import get_logger

            get_logger(__name__).warning(
                f"Failed to save scheduler mirror to {self.local_mirror_path}: {e}"
            )

    def get_tasks(self) -> list[dict[str, Any]]:
        """Get all scheduled tasks."""
        return [asdict(task) for task in self._tasks.values()]

    def get_task(self, name: str) -> dict[str, Any] | None:
        """Get a specific task."""
        task = self._tasks.get(name)
        return asdict(task) if task else None

    def start(self) -> None:
        """Start the background scheduler thread."""
        from backend.config.logger_config import get_logger

        log = get_logger(__name__)

        if self._running:
            log.info("⏰ SchedulerManager is already running.")
            return

        # File-based mutex: prevent multiple scheduler instances on the same
        # host from racing on the same tasks (duplicate mail fetches, racing
        # filesystem cleanups, etc.). For a multi-host deployment this would
        # need to be replaced with a distributed lock (Redis, DB advisory).
        fcntl: Any
        try:
            import fcntl as fcntl_module

            fcntl = fcntl_module
        except ImportError:
            fcntl = None  # Non-POSIX; fall back to in-process singleton only.

        # The lock lives in local_data (NOT in the vault): a flock on a file on
        # OneDrive/virtiofs is not reliably released when the process dies,
        # and every --reload left a phantom lock behind -> the loop would
        # NEVER start ("Another scheduler already holds..."). On local disk it works fine.
        lock_dir = (
            self.local_mirror_path.parent
            if self.local_mirror_path
            else (self.config_path.parent if self.config_path else None)
        )
        if fcntl and lock_dir:
            lock_path = lock_dir / ".scheduler.lock"
            try:
                self._lock_file = open(lock_path, "w")
                fcntl.flock(self._lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (BlockingIOError, OSError):
                log.warning(
                    f"⚠️  Another scheduler already holds {lock_path}. "
                    "Skipping startup to avoid duplicate task execution."
                )
                try:
                    if self._lock_file:
                        self._lock_file.close()
                except Exception:
                    pass
                self._lock_file = None
                return

        log.info("⏰ Starting SchedulerManager background loop...")

        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        log.info("✅ SchedulerManager thread started.")

    def _run_loop(self) -> None:
        """Main scheduler loop."""
        import time
        from backend.config.logger_config import get_logger

        log = get_logger(__name__)

        while self._running:
            try:
                now = datetime.now()
                for name, task in self._tasks.items():
                    if not task.enabled:
                        continue

                    should_run = False
                    if not task.last_run:
                        should_run = True
                    else:
                        last_run_dt = datetime.fromisoformat(task.last_run)
                        elapsed = (now - last_run_dt).total_seconds() / 60
                        if elapsed >= task.interval_minutes:
                            should_run = True

                    if should_run:
                        log.info(f"⏰ Scheduler: Triggering task '{name}'")
                        self.run_task_now(name)

            except Exception as e:
                log.error(f"❌ Error in scheduler loop: {e}")

            time.sleep(60)  # Check every minute

    def update_task(self, name: str, interval_minutes: float, enabled: bool) -> dict[str, Any]:
        """Update a task's configuration."""
        if name not in self._tasks:
            raise ValueError(f"Task '{name}' not found")

        task = self._tasks[name]
        task.interval_minutes = interval_minutes
        task.enabled = enabled

        self._save_config()

        return {"success": True, "task": asdict(task)}

    def clear_all_history(self) -> dict[str, Any]:
        """Clear the execution history of all tasks."""
        for task in self._tasks.values():
            task.last_run = None
            task.status = "idle"

        self._save_config()

        # Also clear DB history
        try:
            with get_mgmt_session() as db:
                db.query(TaskExecutionHistory).delete()
                db.commit()
        except Exception as _e:
            from backend.config.logger_config import get_logger

            get_logger(__name__).warning(f"Could not clear task history: {_e}")

        return {"success": True, "message": "Scheduler history cleared"}

    def run_task_now(self, name: str) -> dict[str, Any]:
        """Run a task immediately."""
        if name not in self._tasks:
            raise ValueError(f"Task '{name}' not found")

        task = self._tasks[name]
        task.status = "running"
        task.last_run = datetime.now().isoformat()

        # "quiet" tasks (e.g. meeting_reminders, every minute) do NOT emit the
        # start/end notifications: they would flood macOS with bubbles. Their alerts
        # own alerts (if any) are handled by the service itself.
        task_spec = self.AVAILABLE_TASKS.get(name)
        quiet = bool(task_spec and task_spec.get("quiet"))

        # Log task start
        if not quiet:
            notify(
                f"Task started: {name.replace('_', ' ').title()}",
                f"Started the {task.description.lower()} process.",
                level="INFO",
            )

        # Save state immediately so UI sees "running"
        self._save_config()

        # Database record for history
        execution_id = None
        try:
            with get_mgmt_session() as db:
                history = TaskExecutionHistory(
                    task_name=name, description=task.description, status="running"
                )
                db.add(history)
                db.commit()
                db.refresh(history)
                execution_id = history.id
        except Exception as e:
            from backend.config.logger_config import get_logger

            get_logger(__name__).error(f"Failed to create task history record: {e}")

        try:
            # Execute the task
            start_time = datetime.now()
            result = self._execute_task(name)
            self._raise_for_task_failure(result)
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()

            task.status = "success"

            # Extract meaningful message from result if possible
            msg = result.get("message") or f"Task {name} completed successfully."
            if "details" in result and isinstance(result["details"], list):
                # Add summary of details if available
                success_count = sum(1 for d in result["details"] if d.get("success"))
                total_count = len(result["details"])
                if total_count > 0:
                    msg = f"Completed: {success_count}/{total_count} subtasks succeeded."

            # Update DB history
            if execution_id:
                try:
                    with get_mgmt_session() as db:
                        stored_history = (
                            db.query(TaskExecutionHistory)
                            .filter(TaskExecutionHistory.id == execution_id)
                            .first()
                        )
                        if stored_history:
                            setattr(stored_history, "status", "success")
                            setattr(stored_history, "message", msg)
                            setattr(
                                stored_history,
                                "finished_at",
                                datetime.now(timezone.utc),
                            )
                            setattr(stored_history, "duration_seconds", duration)
                            db.commit()
                except Exception as _e:
                    # Don't crash the scheduler over a bookkeeping error,
                    # but log so a corrupt task_history DB shows up in logs.
                    from backend.config.logger_config import get_logger

                    get_logger(__name__).warning(f"Could not persist task history for {name}: {_e}")

            if not quiet:
                notify(f"Tasca Finalitzada: {name.replace('_', ' ').title()}", msg, level="SUCCESS")

            self._save_config()
            return {"success": True, "result": result}
        except Exception as e:
            from backend.config.logger_config import get_logger

            log = get_logger(__name__)
            error_msg = str(e)
            log.error(f"❌ Error executing task {name}: {error_msg}")

            # Update DB history on error
            if execution_id:
                try:
                    with get_mgmt_session() as db:
                        stored_history = (
                            db.query(TaskExecutionHistory)
                            .filter(TaskExecutionHistory.id == execution_id)
                            .first()
                        )
                        if stored_history:
                            setattr(stored_history, "status", "error")
                            setattr(stored_history, "message", error_msg)
                            setattr(
                                stored_history,
                                "finished_at",
                                datetime.now(timezone.utc),
                            )
                            db.commit()
                except Exception as _e:
                    # Don't crash the scheduler over a bookkeeping error,
                    # but log so a corrupt task_history DB shows up in logs.
                    from backend.config.logger_config import get_logger

                    get_logger(__name__).warning(f"Could not persist task history for {name}: {_e}")

            if not quiet:
                notify(
                    f"Task error: {name.replace('_', ' ').title()}",
                    f"An execution error occurred: {error_msg}",
                    level="ERROR",
                )

            task.status = "error"
            self._save_config()
            return {"success": False, "error": error_msg}

    @staticmethod
    def _raise_for_task_failure(result: Any) -> None:
        """Turn structured task failures into scheduler execution failures."""

        if not isinstance(result, dict):
            return
        error = result.get("error")
        failed = result.get("success") is False
        if failed or error:
            detail = error or result.get("message") or "Task returned an unsuccessful result"
            raise RuntimeError(str(detail))

    def _task_publish_scheduled_social(self) -> dict[str, Any]:
        """Publishes scheduled social posts that are already due.

        Reuses the async endpoint `process_scheduled_posts`. The job runs in a
        scheduler thread without an event loop, so `asyncio.run` is safe; if
        one were exceptionally already running, we execute it in its own thread.

        """
        import asyncio
        from fastapi import BackgroundTasks
        from backend.api.social_routes import process_scheduled_posts

        def _runner() -> dict[str, Any]:
            result = asyncio.run(process_scheduled_posts(BackgroundTasks()))
            return cast(dict[str, Any], result)

        try:
            return _runner()
        except RuntimeError:
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                return ex.submit(_runner).result()

    def _task_run_capability_automations(self) -> dict[str, Any]:
        """Execute the bounded snapshot of due governed automations."""
        import asyncio

        from backend.services.capability_automations import run_due_automations

        return asyncio.run(run_due_automations())

    def _execute_task(self, name: str) -> dict[str, Any]:
        """Execute a specific task."""
        from backend.api.vault_routes import _load_plugins_state
        from backend.services import builtin_plugins

        return scheduler_task_handlers.execute_task(
            self,
            name,
            _load_plugins_state,
            builtin_plugins.is_enabled,
        )

    def _task_purge_trash(self) -> dict[str, Any]:
        """Purges Vault trash entries older than 90 days.

        The logic lives in `backend/api/vault_routes.py::purge_expired_trash`
        because it shares helpers with the HTTP endpoints.

        """
        from backend.api.vault_routes import purge_expired_trash

        callback = cast(Callable[[], dict[str, Any]], purge_expired_trash)
        return callback()

    def _task_materialize_view_snapshots(self) -> dict[str, Any]:
        """Materializes view snapshots into the markdown across the whole vault
        so the migration is real (views = tables/lists navigable without
        Gnosi). Only rewrites pages with a stale snapshot.

        The logic lives in `backend/api/vault_routes.py::refresh_view_snapshots`
        because it shares the snapshot helpers.

        """
        from backend.api.vault_routes import refresh_view_snapshots

        callback = cast(Callable[[], dict[str, Any]], refresh_view_snapshots)
        return callback()

    def _task_meeting_reminders(self) -> dict[str, Any]:
        """Scans upcoming meetings and sends alerts with an AI-generated agenda.

        The logic lives in `backend/services/meeting_reminders.py`. "quiet" task:
        runs every minute and does NOT emit start/finish notifications.

        """
        from backend.services.meeting_reminders import scan_and_notify

        return scan_and_notify()

    def _task_fetch_mail(self) -> dict[str, Any]:
        """Sync mail from all configured accounts (Gmail + IMAP)."""
        return scheduler_task_handlers.fetch_mail()

    def _task_fetch_contacts(self) -> dict[str, Any]:
        """Fetch Contacts from all configured accounts."""
        return scheduler_task_handlers.fetch_contacts()

    def _task_fetch_feeds(self) -> dict[str, Any]:
        """Fetch RSS/YouTube feeds and store new articles."""
        from backend.services.feed_ingester import fetch_and_store_feeds

        count = fetch_and_store_feeds()
        return {"new_articles": int(count or 0)}

    def _task_fetch_newsletters(self) -> dict[str, Any]:
        """Fetch POP3 newsletters and store new articles."""
        from backend.services.mail_ingester import fetch_and_store_newsletters

        count = fetch_and_store_newsletters()
        return {"new_articles": int(count or 0)}

    def _task_generate_podcast(self) -> dict[str, Any]:
        """Generate the daily podcast from unread articles."""
        from backend.services.audio_summarizer import generate_daily_podcast

        filename = generate_daily_podcast()
        return {"filename": filename, "generated": bool(filename)}

    def _task_llm_wiki_maintenance(self) -> dict[str, Any]:
        """Rebuild managed Brain indexes without invoking an LLM."""
        from backend.api.vault_routes import _llm_wiki_enabled, _load_plugins_state
        from backend.services import llm_wiki_config, llm_wiki_indices, llm_wiki_lint

        is_enabled = cast(Callable[[dict[str, Any]], bool], _llm_wiki_enabled)
        load_plugins_state = cast(Callable[[], dict[str, Any]], _load_plugins_state)
        if not is_enabled(load_plugins_state()):
            return {"skipped": True, "reason": "plugin_disabled"}
        config = llm_wiki_config.load_config()
        brain_table_id = str(config.get("brain_table_id") or "")
        if not brain_table_id:
            return {"skipped": True, "reason": "brain_not_configured"}
        source_ids = [
            str(item.get("table_id") or "")
            for item in config.get("source_tables") or []
            if item.get("table_id")
        ]
        return {
            "indexes": llm_wiki_indices.rebuild_indexes(brain_table_id, config),
            "lint": llm_wiki_lint.run_lint(brain_table_id, source_ids),
        }

    def _task_academic_repository_sync(self) -> dict[str, Any]:
        """Queue due incremental OAI harvests without blocking the scheduler."""
        from backend.scheduler.literature_tasks import queue_due_repository_syncs

        return queue_due_repository_syncs()

    def _task_academic_review_updates(self) -> dict[str, Any]:
        """Queue due saved review strategies without blocking the scheduler."""
        from backend.scheduler.literature_tasks import queue_due_review_updates

        return queue_due_review_updates()

    def _task_system_maintenance(self) -> dict[str, Any]:
        """Comprehensive system cleanup: logs, mailbox, sandbox, and caches."""
        return scheduler_task_handlers.system_maintenance()

    def _task_suggest_connections(self) -> dict[str, Any]:
        """Generate proposals in the canonical Brain connection queue."""

        from backend.api.vault_routes import _llm_wiki_enabled, _load_plugins_state
        from backend.services.llm_wiki_actions import run_maintenance

        is_enabled = cast(Callable[[dict[str, Any]], bool], _llm_wiki_enabled)
        load_plugins_state = cast(Callable[[], dict[str, Any]], _load_plugins_state)
        if not is_enabled(load_plugins_state()):
            return {
                "success": True,
                "skipped": True,
                "message": "LLM Wiki is disabled; connection analysis was skipped.",
            }
        report = run_maintenance(semantic=True)
        return {
            "success": True,
            "message": "Brain connection analysis completed.",
            **report,
        }

    def _task_fetch_calendar(self) -> dict[str, Any]:
        """No-op: hybrid architecture queries the API directly, without syncing to the vault."""
        return {"new_events": 0, "message": "hybrid mode — no vault sync"}

    def _task_update_analytics(self) -> dict[str, Any]:
        """Update cached analytics."""
        from backend.agent.generated_tools.registry import registry

        stats = registry.get_stats()
        return {"stats": stats}

    def _task_update_memories(self) -> dict[str, Any]:
        """Refresh the graph response and analytics without invoking an LLM."""
        return scheduler_task_handlers.update_memories(self._task_update_analytics)


# Singleton
scheduler_manager = SchedulerManager()
