"""Record attempts and report outcomes for work dispatched by the scheduler."""
from __future__ import annotations

from collections.abc import Callable
from contextlib import nullcontext
from datetime import datetime, timezone
from typing import Any

from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_session
from backend.models.scheduler import TaskExecutionHistory
from backend.scheduler.contracts import ScheduledTask
from backend.scheduler.notifications import notify
from backend.services import podcast_episode as episodes
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.utils.metadata_io import MetadataUnavailable

log = get_logger(__name__)

_PODCAST_HISTORY = {
    "waiting": {"en": "Podcast generation is waiting.", "ca": "La generació del podcast està pendent.",
                "es": "La generación del pódcast está pendiente.", "fr": "La génération du podcast est en attente."},
    "error": {"en": "Podcast generation failed.", "ca": "No s’ha pogut generar el podcast.",
              "es": "No se ha podido generar el pódcast.", "fr": "La génération du podcast a échoué."},
    "success": {"en": "Podcast generation finished.", "ca": "Ha finalitzat la generació del podcast.",
                "es": "La generación del pódcast ha finalizado.", "fr": "La génération du podcast est terminée."},
}


def podcast_history_message(status: str, language: str = "en", *, saved_message: str | None = None) -> str:
    """The installation-wide history and notifications can disclose only the task outcome."""
    messages = _PODCAST_HISTORY.get(status, {})
    if saved_message is not None and saved_message in messages.values():
        return saved_message
    return messages.get(language, messages.get("en", ""))


def sync_podcast_history(episode: episodes.Episode, *, language: str | None = None, duration: float | None = None) -> None:
    """Project the current committed occurrence onto its existing installation-wide history row."""
    try:
        with get_mgmt_session() as db:
            # A late scheduler callback must see changes made by a newer Activity
            # worker before writing the shared row. Never hold the occurrence lock here.
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            row = db.get(TaskExecutionHistory, episode.run_id)
            if row is None or str(row.task_name) != "generate_podcast":
                return
            current = episodes.current(episode.vault_path)
            if current is None or current.run_id != episode.run_id:
                return
            if language is None:
                from backend.scheduler.manager import scheduler_manager
                language = scheduler_manager._language
            if str(row.status) != current.status:
                running = current.status == "running"
                setattr(row, "status", current.status)
                setattr(row, "message", None if running else podcast_history_message(current.status, language))
                setattr(row, "finished_at", None if running else datetime.now(timezone.utc))
                setattr(row, "duration_seconds", None)
            if duration is not None and current.status == episode.status == "success" and current.attempts == episode.attempts:
                setattr(row, "duration_seconds", duration)
            db.commit()
    except Exception as error:
        log.warning("Could not update scheduled podcast history (%s)", type(error).__name__)


def recover_podcast_history() -> None:
    """Repair a stopped process between committing its journal and updating shared history."""
    try:
        for episode in episodes.recorded_occurrences():
            sync_podcast_history(episode)
    except Exception as error:
        log.warning("Could not reconcile scheduled podcast history (%s)", type(error).__name__)


def raise_for_task_failure(result: Any) -> None:
    """Turn a handler's structured failure into a scheduler execution failure."""
    if isinstance(result, dict) and (result.get("success") is False or result.get("error")):
        detail = result.get("error") or result.get("message") or "Task returned an unsuccessful result"
        raise RuntimeError(str(detail))


def _start_history(task: ScheduledTask, episode: episodes.Episode | None) -> str | None:
    try:
        with get_mgmt_session() as db:
            row = db.get(TaskExecutionHistory, episode.run_id) if episode else None
            if row is None and episode and episode.source == "reader":
                return None
            if row is None:
                row = TaskExecutionHistory(id=episode.run_id if episode else None,
                    task_name=task.name, description=task.description, status="running")
                db.add(row)
            else:
                setattr(row, "status", "running")
                setattr(row, "finished_at", None)
                setattr(row, "message", None)
            db.commit()
            db.refresh(row)
            return str(row.id)
    except Exception as error:
        log.error("Failed to create task history record: %s", error)
        return None


def _finish_history(history_id: str | None, task: ScheduledTask, message: str, duration: float | None = None) -> None:
    if history_id is None:
        return
    try:
        with get_mgmt_session() as db:
            row = db.get(TaskExecutionHistory, history_id)
            if row is not None:
                setattr(row, "status", task.status)
                setattr(row, "message", message)
                setattr(row, "finished_at", datetime.now(timezone.utc))
                if duration is not None:
                    setattr(row, "duration_seconds", duration)
                db.commit()
    except Exception as error:
        log.warning("Could not persist task history for %s: %s", task.name, error)


def _success_message(name: str, result: dict[str, Any]) -> str:
    details = result.get("details")
    if isinstance(details, list) and details:
        successful = sum(1 for detail in details if detail.get("success"))
        return f"Completed: {successful}/{len(details)} subtasks succeeded."
    return str(result.get("message") or f"Task {name} completed successfully.")


def _failure(task: ScheduledTask, episode: episodes.Episode | None, error: Exception, *,
             history_id: str | None, quiet: bool, language: str) -> dict[str, Any]:
    if episode and isinstance(error, episodes.EpisodeBusy):
        episodes.finish(episode, "running")
        task.status = "running"
        return {"success": True, "result": {"status": task.status}}
    if episode and isinstance(error, MetadataUnavailable):
        episodes.cloud_failure(episode, error, language=language)
        task.status = episode.status
    else:
        if episode:
            episodes.finish(episode, "error", language=language)
        task.status = "error"
    message = podcast_history_message(task.status, language) if task.name == "generate_podcast" else str(error)
    log.info("Scheduled task %s ended with %s: %s", task.name, task.status, message)
    if episode is None:
        _finish_history(history_id, task, message)
    if not quiet and task.status == "error":
        notify(f"Task error: {task.name.replace('_', ' ').title()}",
               f"An execution error occurred: {message}", level="ERROR")
    return {"success": False, "status": task.status, "error": message}


def run_task(
    task: ScheduledTask, episode: episodes.Episode | None, *, execute: Callable[[str], dict[str, Any]],
    save_config: Callable[[], None], quiet: bool, language: str,
) -> dict[str, Any]:
    """Run once, recording every retry of a podcast occurrence on its original history row."""
    task.status = "running"
    started = datetime.fromisoformat(episode.period_end).astimezone().replace(tzinfo=None) if episode else datetime.now()
    task.last_run = started.isoformat()
    title = task.name.replace("_", " ").title()
    if not quiet and (episode is None or not episode.attempts):
        notify(f"Task started: {title}", f"Started the {task.description.lower()} process.", level="INFO")
    save_config()
    history_id = _start_history(task, episode)
    try:
        start_time = datetime.now()
        binding = (execution_scope(ExecutionScope.model_validate(episode.scope), origin="button")
                   if episode and episode.source == "reader" and episode.scope else nullcontext())
        with binding:
            result = execute(task.name)
        raise_for_task_failure(result)
        if episode and result.get("skipped"):
            raise RuntimeError(result.get("message", "podcast_plugin_unavailable"))
        duration = (datetime.now() - start_time).total_seconds()
        if episode:
            episodes.finish(episode, "success", language=language, duration=duration)
        task.status = "success"
        message = (podcast_history_message(task.status, language) if task.name == "generate_podcast"
                   else _success_message(task.name, result))
        if episode is None:
            _finish_history(history_id, task, message, duration)
        if not quiet:
            notify(f"Tasca Finalitzada: {title}", message, level="SUCCESS")
        outcome = {"success": True, "result": result}
    except Exception as error:
        outcome = _failure(task, episode, error, history_id=history_id, quiet=quiet, language=language)
    save_config()
    return outcome
