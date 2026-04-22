"""
Scheduler Manager: Manages scheduled tasks using APScheduler.
"""

import json
import os
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, asdict
import asyncio
import threading
from backend.config.app_config import load_params
from backend.data.management_db import get_mgmt_session
from backend.models.scheduler import TaskExecutionHistory

# Try to import notification service from skills
try:
    from pipeline.skills.notification_service.scripts.notification_service import notify
except ImportError:
    # Fallback if skill is not available or path issues
    def notify(title, message, level="INFO", workspace_id="default"):
        pass


@dataclass
class ScheduledTask:
    name: str
    description: str
    interval_minutes: int
    enabled: bool
    last_run: Optional[str] = None
    next_run: Optional[str] = None
    status: str = "idle"  # idle, running, success, error


class SchedulerManager:
    """
    Manages scheduled background tasks.
    Uses a simple file-based persistence for task configurations.
    """

    AVAILABLE_TASKS = {
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
            "description": "Manteniment del sistema (Logs, Mailbox, Sandbox)",
            "default_interval": 1440,  # 24 hours
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
            "description": "Verificació de tokens de calendari",
            "default_interval": 60,  # 1 hour
        },
        "fetch_mail": {
            "description": "Sync correu (Gmail, IMAP)",
            "default_interval": 30,  # 30 minutes
        },
        "fetch_contacts": {
            "description": "Sync comptes (Google, CardDAV)",
            "default_interval": 1440,  # 24 hours
        },
        "update_memories": {
            "description": "Actualització General de Memòria (Graf i Connexions)",
            "default_interval": 1440,  # 24 hours
        },
    }

    def __init__(self):
        cfg = load_params(strict_env=False)
        self.config_path = cfg.paths.get("SCHEDULER")
        
        if self.config_path:
            try:
                self.config_path.parent.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                pass

        self._tasks: Dict[str, ScheduledTask] = {}
        self._running = False
        self._thread: Optional[threading.Thread] = None

        self._load_config()

    def _load_config(self):
        """Load scheduler configuration from file."""
        if not self.config_path or not self.config_path.exists():
            self._init_default_tasks()
            return
            
        try:
            updated = False
            with open(self.config_path) as f:
                data = json.load(f)
                for name, task_data in data.get("tasks", {}).items():
                    self._tasks[name] = ScheduledTask(**task_data)

                # Filter out tasks that are no longer in AVAILABLE_TASKS
                current_task_names = list(self._tasks.keys())
                for task_name in current_task_names:
                    if task_name not in self.AVAILABLE_TASKS:
                        del self._tasks[task_name]
                        updated = True

                # Ensure all available tasks exist
                for name, config in self.AVAILABLE_TASKS.items():
                    if name not in self._tasks:
                        self._tasks[name] = ScheduledTask(
                            name=name,
                            description=config["description"],
                            interval_minutes=config["default_interval"],
                            enabled=False,
                        )
                        updated = True

                if updated:
                    self._save_config()
        except Exception as e:
            from backend.config.logger_config import get_logger
            log = get_logger(__name__)
            log.error(f"❌ Error loading scheduler config: {e}")
            if not self._tasks:
                self._init_default_tasks()

    def _init_default_tasks(self):
        """Initialize with default tasks."""
        for name, config in self.AVAILABLE_TASKS.items():
            self._tasks[name] = ScheduledTask(
                name=name,
                description=config["description"],
                interval_minutes=config["default_interval"],
                enabled=False,  # Disabled by default
            )
        self._save_config()

    def _save_config(self):
        """Save scheduler configuration to file."""
        if not self.config_path:
            return
            
        try:
            data = {"tasks": {name: asdict(task) for name, task in self._tasks.items()}}
            with open(self.config_path, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            pass

    def get_tasks(self) -> List[Dict[str, Any]]:
        """Get all scheduled tasks."""
        return [asdict(task) for task in self._tasks.values()]

    def get_task(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a specific task."""
        task = self._tasks.get(name)
        return asdict(task) if task else None

    def start(self):
        """Start the background scheduler thread."""
        from backend.config.logger_config import get_logger
        log = get_logger(__name__)

        if self._running:
            log.info("⏰ SchedulerManager is already running.")
            return

        log.info("⏰ Starting SchedulerManager background loop...")
        
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        log.info("✅ SchedulerManager thread started.")

    def _run_loop(self):
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

    def update_task(
        self, name: str, interval_minutes: int, enabled: bool
    ) -> Dict[str, Any]:
        """Update a task's configuration."""
        if name not in self._tasks:
            raise ValueError(f"Task '{name}' not found")

        task = self._tasks[name]
        task.interval_minutes = interval_minutes
        task.enabled = enabled

        self._save_config()

        return {"success": True, "task": asdict(task)}

    def clear_all_history(self) -> Dict[str, Any]:
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
        except Exception: pass

        return {"success": True, "message": "Scheduler history cleared"}

    def run_task_now(self, name: str) -> Dict[str, Any]:
        """Run a task immediately."""
        if name not in self._tasks:
            raise ValueError(f"Task '{name}' not found")

        task = self._tasks[name]
        task.status = "running"
        task.last_run = datetime.now().isoformat()
        
        # Log task start
        notify(
            f"Tasca Iniciada: {name.replace('_', ' ').title()}", 
            f"S'ha iniciat el procés de {task.description.lower()}.",
            level="INFO"
        )
        
        # Save state immediately so UI sees "running"
        self._save_config()

        # Database record for history
        execution_id = None
        try:
            with get_mgmt_session() as db:
                history = TaskExecutionHistory(
                    task_name=name,
                    description=task.description,
                    status="running"
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
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()
            
            task.status = "success"
            
            # Extract meaningful message from result if possible
            msg = result.get("message") or f"La tasca {name} s'ha completat correctament."
            if "details" in result and isinstance(result["details"], list):
                # Add summary of details if available
                success_count = sum(1 for d in result["details"] if d.get("success"))
                total_count = len(result["details"])
                if total_count > 0:
                    msg = f"Completat: {success_count}/{total_count} sub-tasques amb èxit."

            # Update DB history
            if execution_id:
                try:
                    with get_mgmt_session() as db:
                        history = db.query(TaskExecutionHistory).filter(TaskExecutionHistory.id == execution_id).first()
                        if history:
                            history.status = "success"
                            history.message = msg
                            history.finished_at = datetime.now(timezone.utc)
                            history.duration_seconds = duration
                            db.commit()
                except Exception: pass

            notify(
                f"Tasca Finalitzada: {name.replace('_', ' ').title()}", 
                msg,
                level="SUCCESS"
            )
            
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
                        history = db.query(TaskExecutionHistory).filter(TaskExecutionHistory.id == execution_id).first()
                        if history:
                            history.status = "error"
                            history.message = error_msg
                            history.finished_at = datetime.now(timezone.utc)
                            db.commit()
                except Exception: pass

            notify(
                f"Error en Tasca: {name.replace('_', ' ').title()}", 
                f"S'ha produït un error en l'execució: {error_msg}",
                level="ERROR"
            )
            
            task.status = "error"
            self._save_config()
            return {"success": False, "error": error_msg}

    def _execute_task(self, name: str) -> Dict[str, Any]:
        """Execute a specific task."""
        if name == "fetch_feeds":
            return self._task_fetch_feeds()
        elif name == "fetch_newsletters":
            return self._task_fetch_newsletters()
        elif name == "generate_podcast":
            return self._task_generate_podcast()
        elif name == "system_maintenance":
            return self._task_system_maintenance()
        elif name == "update_analytics":
            return self._task_update_analytics()
        elif name == "suggest_connections":
            return self._task_suggest_connections()
        elif name == "fetch_calendar":
            return self._task_fetch_calendar()
        elif name == "fetch_mail":
            return self._task_fetch_mail()
        elif name == "fetch_contacts":
            return self._task_fetch_contacts()
        elif name == "update_memories":
            return self._task_update_memories()

        return {"error": f"Unknown task: {name}"}

    def _task_fetch_mail(self) -> Dict[str, Any]:
        """Sync mail from all configured accounts (Gmail + IMAP)."""
        from backend.services.integration_manager import integration_manager
        from backend.services.vault_mail_sync_service import sync_service

        integrations = integration_manager.get_all_safe()
        accounts = integrations.get("emails", [])
        total = 0
        details = []
        for acc in accounts:
            email = acc.get("email") or acc.get("username")
            if not email:
                continue
            try:
                provider = acc.get("provider", "")
                auth_type = acc.get("auth_type", "")
                if provider == "google" or auth_type == "oauth2":
                    count = sync_service.sync_emails(email, limit=50)
                else:
                    from backend.services.imap_mail_sync_service import imap_sync_service
                    count = imap_sync_service.sync_account(email, limit=50)
                total += count or 0
                details.append({"account": email, "success": True, "count": count or 0})
            except Exception as ex:
                details.append({"account": email, "success": False, "error": str(ex)})
        return {"new_emails": total, "details": details}

    def _task_fetch_contacts(self) -> Dict[str, Any]:
        """Fetch Contacts from all configured accounts."""
        from backend.services.integration_manager import integration_manager
        from backend.services.contacts_sync_engine import ContactsSyncEngine
        from backend.data.management_db import db_manager
        
        results = {"success": True, "details": []}
        integrations = integration_manager.get_all_safe()
        contact_accounts = integrations.get("contacts", [])
        
        if not contact_accounts:
            return {"success": True, "message": "No contact accounts configured"}

        for account in contact_accounts:
            try:
                with db_manager.mgmt_session() as db:
                    engine = ContactsSyncEngine(db, account, workspace_id="personal") # Defaulting to personal for background sync
                    sync_res = engine.sync_full_bidirectional()
                    results["details"].append({
                        "id": account.get("id"),
                        "email": account.get("email"),
                        "result": sync_res
                    })
            except Exception as e:
                results["details"].append({
                    "id": account.get("id"),
                    "error": str(e)
                })
        
        return results

    def _task_fetch_feeds(self) -> Dict[str, Any]:
        """Fetch RSS/YouTube feeds and store new articles."""
        from backend.services.feed_ingester import fetch_and_store_feeds

        count = fetch_and_store_feeds()
        return {"new_articles": int(count or 0)}

    def _task_fetch_newsletters(self) -> Dict[str, Any]:
        """Fetch POP3 newsletters and store new articles."""
        from backend.services.mail_ingester import fetch_and_store_newsletters

        count = fetch_and_store_newsletters()
        return {"new_articles": int(count or 0)}

    def _task_generate_podcast(self) -> Dict[str, Any]:
        """Generate the daily podcast from unread articles."""
        from backend.services.audio_summarizer import generate_daily_podcast

        filename = generate_daily_podcast()
        return {"filename": filename, "generated": bool(filename)}


    def _task_system_maintenance(self) -> Dict[str, Any]:
        """Comprehensive system cleanup: logs, mailbox, sandbox, and caches."""
        import glob
        import os
        import shutil
        from backend.config.logger_config import get_logger
        
        log = get_logger(__name__)
        purged_count = 0
        freed_bytes = 0
        details = {}
        
        cfg = load_params(strict_env=False)
        
        # 1. Purge Logs
        log_dir = cfg.paths.get("LOG_DIR")
        if log_dir and log_dir.exists():
            log_patterns = [str(log_dir / "*.log"), str(log_dir.parent / "*.log")]
            
            project_root = cfg.paths.get("PROJECT_DIR")
            if project_root:
                pipeline_base = project_root / "monorepo" / "apps" / "gnosi" / "pipeline"
                log_patterns.append(str(pipeline_base / "sandbox" / "*.log"))
                log_patterns.append(str(pipeline_base / ".tmp" / "*.log"))

            for pattern in log_patterns:
                for filepath in glob.glob(pattern):
                    try:
                        size = os.path.getsize(filepath)
                        if size > 0:
                            with open(filepath, 'w') as f:
                                f.write(f"# Log purged at {datetime.now().isoformat()}\n")
                            purged_count += 1
                            freed_bytes += size
                    except Exception as e:
                        log.warning(f"Failed to purge log {filepath}: {e}")
        details["logs_cleared"] = purged_count

        # 2. Clear Agent Mailbox Archive
        mailbox_archive = Path("/Users/ismaelgarciafernandez/Projectes/monorepo/.antigravity/team/mailbox/archive")
        msg_purged = 0
        if mailbox_archive.exists():
            for msg_file in glob.glob(str(mailbox_archive / "*")):
                try:
                    freed_bytes += os.path.getsize(msg_file)
                    os.remove(msg_file)
                    msg_purged += 1
                except Exception as e:
                    log.warning(f"Failed to delete message {msg_file}: {e}")
        details["mailbox_archive_purged"] = msg_purged

        # 3. Cleanup Pipeline Sandbox & .tmp
        pipeline_dirs = []
        if project_root:
             p_base = project_root / "monorepo" / "apps" / "gnosi" / "pipeline"
             pipeline_dirs = [p_base / "sandbox", p_base / ".tmp"]

        sandbox_deleted = 0
        for d in pipeline_dirs:
            if d.exists():
                for item in d.iterdir():
                    if item.name == "__init__.py": continue
                    try:
                        if item.is_file():
                            freed_bytes += os.path.getsize(item)
                            os.remove(item)
                            sandbox_deleted += 1
                        elif item.is_dir():
                            shutil.rmtree(item)
                            sandbox_deleted += 1
                    except Exception as e:
                        log.warning(f"Failed to delete {item}: {e}")
        details["temporary_files_deleted"] = sandbox_deleted

        # 4. Cleanup Pycache
        pycache_count = 0
        if project_root:
            for root, dirs, files in os.walk(project_root / "monorepo" / "apps" / "gnosi"):
                for d in dirs:
                    if d == "__pycache__":
                        try:
                            shutil.rmtree(os.path.join(root, d))
                            pycache_count += 1
                        except Exception:
                            pass
        details["pycache_dirs_removed"] = pycache_count
                    
        # 5. Cleanup In-Memory Cache
        from backend.utils.cache import global_cache
        global_cache.clear()
        details["global_cache_cleared"] = True
                    
        return {
            "message": "System maintenance completed successfully",
            "freed_bytes": freed_bytes,
            "details": details
        }

    def _task_suggest_connections(self) -> Dict[str, Any]:
        """Analyze connections between notes."""
        try:
            from pipeline.skills.suggest_connections.scripts import (
                suggest_connections_digital_brain,
            )
            from pipeline.skills.json_to_sigma.scripts import json_to_sigma
            suggest_connections_digital_brain.process()
            json_to_sigma.convert_for_sigma()
        except ImportError:
            return {"error": "Pipeline skills not found"}
        except Exception as e:
            return {"success": False, "error": str(e)}





    def _task_fetch_calendar(self) -> Dict[str, Any]:
        """No-op: arquitectura híbrida consulta l'API directament, sense sync al vault."""
        return {"new_events": 0, "message": "hybrid mode — no vault sync"}

    def _task_update_analytics(self) -> Dict[str, Any]:
        """Update cached analytics."""
        from backend.agent.generated_tools.registry import registry

        stats = registry.get_stats()
        return {"stats": stats}

    def _task_update_memories(self) -> Dict[str, Any]:
        """Performs a general update of the memory system (Graph + Connections)."""
        from backend.services.graph_service import GraphService
        from backend.config.logger_config import get_logger
        log = get_logger(__name__)
        
        results = {"success": True, "steps": []}
        
        try:
            # 1. Clear Graph Cache and Force Rebuild
            log.info("⏰ Scheduler: Force rebuilding Unified Graph...")
            GraphService._graph_cache = None
            service = GraphService()
            graph = service.build_unified_graph()
            results["steps"].append(f"Graph rebuilt with {len(graph.get('nodes', []))} nodes")
            
            # 2. Update semantic connections (reuse suggest_connections logic)
            log.info("⏰ Scheduler: Updating semantic connections...")
            conn_res = self._task_suggest_connections()
            results["steps"].append({"suggest_connections": conn_res})
            
            # 3. Update analytics to reflect new state
            self._task_update_analytics()
            results["steps"].append("Analytics updated")
            
        except Exception as e:
            log.error(f"❌ Error in update_memories task: {e}")
            return {"success": False, "error": str(e)}
            
        return results


# Singleton
scheduler_manager = SchedulerManager()
