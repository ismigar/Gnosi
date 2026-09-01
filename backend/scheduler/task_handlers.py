"""Large scheduler task handlers kept outside the lifecycle manager."""

from __future__ import annotations

import glob
import logging
import os
import shutil
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from backend.config.app_config import load_params
from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_session


TaskResult = dict[str, Any]


class SchedulerTaskPort(Protocol):
    """Scheduler methods required by the name-to-handler dispatcher."""

    TASK_PLUGIN_REQUIREMENTS: dict[str, tuple[str, ...]]

    def _task_fetch_feeds(self) -> TaskResult: ...

    def _task_fetch_newsletters(self) -> TaskResult: ...

    def _task_generate_podcast(self) -> TaskResult: ...

    def _task_system_maintenance(self) -> TaskResult: ...

    def _task_llm_wiki_maintenance(self) -> TaskResult: ...

    def _task_academic_repository_sync(self) -> TaskResult: ...

    def _task_academic_review_updates(self) -> TaskResult: ...

    def _task_update_analytics(self) -> TaskResult: ...

    def _task_suggest_connections(self) -> TaskResult: ...

    def _task_fetch_calendar(self) -> TaskResult: ...

    def _task_fetch_mail(self) -> TaskResult: ...

    def _task_fetch_contacts(self) -> TaskResult: ...

    def _task_update_memories(self) -> TaskResult: ...

    def _task_purge_trash(self) -> TaskResult: ...

    def _task_publish_scheduled_social(self) -> TaskResult: ...

    def _task_materialize_view_snapshots(self) -> TaskResult: ...

    def _task_meeting_reminders(self) -> TaskResult: ...

    def _task_run_capability_automations(self) -> TaskResult: ...


def execute_task(
    manager: SchedulerTaskPort,
    name: str,
    load_plugin_state: Callable[[], dict[str, Any]],
    plugin_enabled: Callable[[dict[str, Any], str], bool],
) -> TaskResult:
    """Dispatch one configured task after enforcing plugin requirements."""
    required_plugins = manager.TASK_PLUGIN_REQUIREMENTS.get(name, ())
    if required_plugins:
        try:
            state = load_plugin_state()
        except Exception as error:
            return {
                "success": True,
                "skipped": True,
                "message": f"Task paused because plugin state is unavailable: {error}",
            }
        missing = [
            plugin_id for plugin_id in required_plugins if not plugin_enabled(state, plugin_id)
        ]
        if missing:
            return {
                "success": True,
                "skipped": True,
                "message": "Task paused while plugins are disabled: " + ", ".join(missing),
            }
    handlers: dict[str, Callable[[], TaskResult]] = {
        "fetch_feeds": manager._task_fetch_feeds,
        "fetch_newsletters": manager._task_fetch_newsletters,
        "generate_podcast": manager._task_generate_podcast,
        "system_maintenance": manager._task_system_maintenance,
        "llm_wiki_maintenance": manager._task_llm_wiki_maintenance,
        "academic_repository_sync": manager._task_academic_repository_sync,
        "academic_review_updates": manager._task_academic_review_updates,
        "update_analytics": manager._task_update_analytics,
        "suggest_connections": manager._task_suggest_connections,
        "fetch_calendar": manager._task_fetch_calendar,
        "fetch_mail": manager._task_fetch_mail,
        "fetch_contacts": manager._task_fetch_contacts,
        "update_memories": manager._task_update_memories,
        "purge_trash": manager._task_purge_trash,
        "publish_scheduled_social": manager._task_publish_scheduled_social,
        "materialize_view_snapshots": manager._task_materialize_view_snapshots,
        "meeting_reminders": manager._task_meeting_reminders,
        "run_capability_automations": manager._task_run_capability_automations,
    }
    handler = handlers.get(name)
    return handler() if handler else {"error": f"Unknown task: {name}"}


def fetch_mail() -> TaskResult:
    """Synchronize mail from every enabled Gmail or IMAP account."""
    from backend.services.imap_mail_sync_service import imap_sync_service
    from backend.services.integration_manager import integration_manager
    from backend.services.vault_mail_sync_service import sync_service

    total = 0
    details: list[dict[str, Any]] = []
    seen: set[str] = set()
    for account in integration_manager.get_all_mail_accounts(only_enabled=True):
        email = account.get("email") or account.get("username")
        if not email or email in seen:
            continue
        seen.add(email)
        try:
            if integration_manager.is_imap_account(account):
                count = imap_sync_service.sync_account(email, limit=50)
            elif integration_manager.is_microsoft_account(account):
                count = 0
            else:
                count = sync_service.sync_emails(email, limit=50)
            total += count or 0
            details.append({"account": email, "success": True, "count": count or 0})
        except Exception as error:
            details.append({"account": email, "success": False, "error": str(error)})
    return {"new_emails": total, "details": details}


def fetch_contacts() -> TaskResult:
    """Synchronize contacts from every configured account."""
    from backend.services.contacts_sync_engine import ContactsSyncEngine
    from backend.services.integration_manager import integration_manager

    results: TaskResult = {"success": True, "details": []}
    integrations = integration_manager.get_all_safe()
    contact_accounts = integrations.get("contacts", [])
    if not contact_accounts:
        return {"success": True, "message": "No contact accounts configured"}
    details = results["details"]
    if not isinstance(details, list):
        return results
    for account in contact_accounts:
        try:
            with get_mgmt_session() as database:
                engine = ContactsSyncEngine(
                    db=database,
                    workspace_id="personal",
                    integration=account,
                )
                sync_result = engine.sync_full_bidirectional()
                details.append(
                    {
                        "id": account.get("id"),
                        "email": account.get("email"),
                        "result": sync_result,
                    }
                )
        except Exception as error:
            details.append({"id": account.get("id"), "error": str(error)})
    return results


def _purge_logs(
    log_directory: Path | None,
    pipeline_base: Path,
    logger: logging.Logger,
) -> tuple[int, int]:
    count = 0
    freed_bytes = 0
    if log_directory and log_directory.exists():
        log_patterns = [
            str(log_directory / "*.log"),
            str(log_directory.parent / "*.log"),
            str(pipeline_base / "sandbox" / "*.log"),
            str(pipeline_base / ".tmp" / "*.log"),
        ]
        for pattern in log_patterns:
            for file_name in glob.glob(pattern):
                try:
                    size = os.path.getsize(file_name)
                    if size > 0:
                        Path(file_name).write_text(
                            f"# Log purged at {datetime.now().isoformat()}\n",
                            encoding="utf-8",
                        )
                        count += 1
                        freed_bytes += size
                except Exception as error:
                    logger.warning("Failed to purge log %s: %s", file_name, error)
    return count, freed_bytes


def _mailbox_archive_path() -> Path:
    repository_root = os.environ.get("REPO_ROOT")
    if repository_root:
        project_root = Path(repository_root)
    else:
        host_home = os.environ.get("HOME_HOST_PATH") or str(Path.home())
        project_root = Path(host_home) / "Projectes"
    return project_root / ".antigravity" / "team" / "mailbox" / "archive"


def _purge_mailbox_archive(logger: logging.Logger) -> tuple[int, int]:
    mailbox_archive = _mailbox_archive_path()
    count = 0
    freed_bytes = 0
    if mailbox_archive.exists():
        for message_file in glob.glob(str(mailbox_archive / "*")):
            try:
                freed_bytes += os.path.getsize(message_file)
                os.remove(message_file)
                count += 1
            except Exception as error:
                logger.warning(
                    "Failed to delete message %s: %s",
                    message_file,
                    error,
                )
    return count, freed_bytes


def _purge_temporary_files(
    pipeline_base: Path,
    logger: logging.Logger,
) -> tuple[int, int]:
    count = 0
    freed_bytes = 0
    for directory in (pipeline_base / "sandbox", pipeline_base / ".tmp"):
        if not directory.exists():
            continue
        for item in directory.iterdir():
            if item.name == "__init__.py":
                continue
            try:
                if item.is_file():
                    freed_bytes += item.stat().st_size
                    item.unlink()
                    count += 1
                elif item.is_dir():
                    shutil.rmtree(item)
                    count += 1
            except Exception as error:
                logger.warning("Failed to delete %s: %s", item, error)
    return count, freed_bytes


def _purge_pycaches(gnosi_root: Path, pipeline_base: Path) -> int:
    count = 0
    for code_directory in (gnosi_root / "backend", pipeline_base):
        if not code_directory.exists():
            continue
        for root, directories, _files in os.walk(code_directory):
            for directory_name in directories:
                if directory_name != "__pycache__":
                    continue
                try:
                    shutil.rmtree(Path(root) / directory_name)
                    count += 1
                except Exception:
                    pass
    return count


def system_maintenance() -> TaskResult:
    """Clean bounded logs, private mailbox archives, temporary files, and caches."""
    logger = get_logger(__name__)
    details: dict[str, Any] = {}
    config = load_params(strict_env=False)
    gnosi_root = Path(__file__).resolve().parents[2]
    pipeline_base = gnosi_root / "pipeline"
    logs_cleared, log_bytes = _purge_logs(
        config.paths.get("LOG_DIR"),
        pipeline_base,
        logger,
    )
    mailbox_purged, mailbox_bytes = _purge_mailbox_archive(logger)
    temporary_deleted, temporary_bytes = _purge_temporary_files(
        pipeline_base,
        logger,
    )
    details["logs_cleared"] = logs_cleared
    details["mailbox_archive_purged"] = mailbox_purged
    details["temporary_files_deleted"] = temporary_deleted
    details["pycache_dirs_removed"] = _purge_pycaches(gnosi_root, pipeline_base)

    from backend.utils.cache import global_cache

    global_cache.clear()
    details["global_cache_cleared"] = True
    return {
        "message": "System maintenance completed successfully",
        "freed_bytes": log_bytes + mailbox_bytes + temporary_bytes,
        "details": details,
    }


def update_memories(update_analytics: Callable[[], TaskResult]) -> TaskResult:
    """Refresh the graph, connection queue count, and analytics."""
    from backend.services import llm_wiki_suggestions
    from backend.services.graph_service import GraphService

    logger = get_logger(__name__)
    results: TaskResult = {"success": True, "steps": []}
    steps = results["steps"]
    if not isinstance(steps, list):
        return results
    try:
        logger.info("⏰ Scheduler: Force rebuilding Unified Graph...")
        GraphService.invalidate_response_cache()
        graph = GraphService().build_unified_graph()
        nodes = graph.get("nodes", [])
        steps.append(f"Graph rebuilt with {len(nodes)} nodes")
        steps.append({"connections_pending": len(llm_wiki_suggestions.load_queue())})
        update_analytics()
        steps.append("Analytics updated")
    except Exception as error:
        logger.error("❌ Error in update_memories task: %s", error)
        return {"success": False, "error": str(error)}
    return results


__all__ = [
    "SchedulerTaskPort",
    "TaskResult",
    "execute_task",
    "fetch_contacts",
    "fetch_mail",
    "system_maintenance",
    "update_memories",
]
