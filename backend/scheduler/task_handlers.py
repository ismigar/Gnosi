"""Large scheduler task handlers kept outside the lifecycle manager."""

from __future__ import annotations

import logging
import os
import stat
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Protocol

from backend.config.data_dir import resolve_data_dir
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


# LOCAL_DATA is resolved by the same canonical resolver as paths_config. Only
# this known application log is eligible, and only when the real logger selects
# it. External/early-boot logs and arbitrary files in the logs folder are not.
_MAINTENANCE_LOG = Path("logs") / "gnosi.log"


def _descriptor_cleanup_supported() -> bool:
    """Fail closed on platforms without no-follow, directory-relative IO."""
    return (
        hasattr(os, "O_NOFOLLOW")
        and hasattr(os, "O_DIRECTORY")
        and os.open in os.supports_dir_fd
    )


@contextmanager
def _maintenance_directory(directory: Path) -> Iterator[int]:
    """Pin each directory component without resolving or following symlinks."""
    if not directory.is_absolute() or ".." in directory.parts:
        raise ValueError("Maintenance requires an absolute path without traversal")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(directory.anchor, flags)
    try:
        for component in directory.parts[1:]:
            child = os.open(component, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        yield descriptor
    finally:
        os.close(descriptor)


def _maintenance_data_root() -> Path:
    """Use the existing resolver, without config migration or directory creation."""
    # The resolver normalizes '..'; reject it before that information is lost.
    for key in ("GNOSI_DATA_DIR", "GNOSI_LOCAL_DATA", "LOCAL_DATA_DIR"):
        configured = os.environ.get(key)
        if configured:
            candidate = Path(configured).expanduser()
            if not candidate.is_absolute() or ".." in candidate.parts:
                raise ValueError("Maintenance data selector must be absolute without traversal")
            break
    root = resolve_data_dir(create=False)
    if root == root.parent:
        raise ValueError("Maintenance must not use a filesystem root")
    return root


def _purge_logs(data_root: Path, logger: logging.Logger) -> tuple[int, int]:
    """Truncate the real log only at its canonical location; preserve its inode."""
    from backend.config.logger_config import LOG_FILE

    if LOG_FILE != data_root / _MAINTENANCE_LOG:
        return 0, 0
    try:
        with _maintenance_directory(data_root / _MAINTENANCE_LOG.parent) as directory:
            descriptor = os.open(
                _MAINTENANCE_LOG.name,
                os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=directory,
            )
            try:
                info = os.fstat(descriptor)
                # Hard links can alias a DB, credential or external user log.
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not info.st_size:
                    return 0, 0
                os.ftruncate(descriptor, 0)
                return 1, info.st_size
            finally:
                os.close(descriptor)
    except FileNotFoundError:
        pass
    except (OSError, ValueError) as error:
        logger.warning("Application log cleanup skipped: %s", error)
    return 0, 0


def system_maintenance() -> TaskResult:
    """Clear the bounded real app log and RAM cache, never source or user data.

    Source sandbox/.tmp, pycache and private mailbox cleanup is retired. No
    reviewed producer exposes disposable local temporaries, so their legacy
    counter stays zero; no replacement directory or filename contract is added.
    """
    logger = get_logger(__name__)
    logs_cleared = log_bytes = 0
    try:
        if not _descriptor_cleanup_supported():
            raise ValueError("Safe directory-relative cleanup is unavailable on this platform")
        data_root = _maintenance_data_root()
        logs_cleared, log_bytes = _purge_logs(data_root, logger)
    except (OSError, ValueError) as error:
        logger.warning("Disk maintenance skipped: %s", error)

    from backend.utils.cache import global_cache

    global_cache.clear()
    return {
        "message": "System maintenance completed successfully",
        "freed_bytes": log_bytes,
        "details": {
            "logs_cleared": logs_cleared,
            "mailbox_archive_purged": 0,
            "temporary_files_deleted": 0,
            "pycache_dirs_removed": 0,
            "global_cache_cleared": True,
        },
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
