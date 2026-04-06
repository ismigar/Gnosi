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
        "sync_directives": {
            "description": "Sync directives to Notion",
            "default_interval": 1440,  # 24 hours
        },
        "backup_tools": {
            "description": "Backup approved tools",
            "default_interval": 720,  # 12 hours
        },
        "cleanup_rejected": {
            "description": "Cleanup old rejected tools",
            "default_interval": 10080,  # 7 days
        },
        "update_analytics": {
            "description": "Update statistics",
            "default_interval": 60,  # 1 hour
        },
    }

    def __init__(self):
        cfg = load_params(strict_env=False)
        self.config_path = cfg.paths.get("SCHEDULER")
        
        if self.config_path:
            try:
                self.config_path.parent.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                print(f"⚠️ Scheduler: Error creating configuration directory: {e}")

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
            with open(self.config_path) as f:
                data = json.load(f)
                for name, task_data in data.get("tasks", {}).items():
                    self._tasks[name] = ScheduledTask(**task_data)
        except Exception as e:
            print(f"⚠️ Scheduler: Error loading configuration, restoring default values: {e}")
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
            print(f"⚠️ Scheduler: Could not save configuration: {e}")

    def get_tasks(self) -> List[Dict[str, Any]]:
        """Get all scheduled tasks."""
        return [asdict(task) for task in self._tasks.values()]

    def get_task(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a specific task."""
        task = self._tasks.get(name)
        return asdict(task) if task else None

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

    def run_task_now(self, name: str) -> Dict[str, Any]:
        """Run a task immediately."""
        if name not in self._tasks:
            raise ValueError(f"Task '{name}' not found")

        task = self._tasks[name]
        task.status = "running"
        task.last_run = datetime.utcnow().isoformat()

        try:
            # Execute the task
            result = self._execute_task(name)
            task.status = "success"
            self._save_config()
            return {"success": True, "result": result}
        except Exception as e:
            task.status = "error"
            self._save_config()
            return {"success": False, "error": str(e)}

    def _execute_task(self, name: str) -> Dict[str, Any]:
        """Execute a specific task."""
        if name == "sync_directives":
            return self._task_sync_directives()
        elif name == "backup_tools":
            return self._task_backup_tools()
        elif name == "cleanup_rejected":
            return self._task_cleanup_rejected()
        elif name == "update_analytics":
            return self._task_update_analytics()
        else:
            return {"error": f"Unknown task: {name}"}

    def _task_sync_directives(self) -> Dict[str, Any]:
        """Sync directives to Notion."""
        from backend.sync.notion_exporter import notion_exporter
        import asyncio

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(notion_exporter.export_all_directives())
            return result
        finally:
            loop.close()

    def _task_backup_tools(self) -> Dict[str, Any]:
        """Backup approved tools."""
        from backend.agent.generated_tools.registry import registry

        approved = registry.list_approved()
        cfg = load_params(strict_env=False)
        backup_base = cfg.paths.get("BACKUPS")
        if not backup_base:
            return {"error": "Backup path not structurally configured in the Vault."}
            
        backup_dir = backup_base / "tools"
        backup_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

        for tool in approved:
            backup_file = backup_dir / f"{tool.name}_{timestamp}.py"
            backup_file.write_text(tool.code)

        return {"backed_up": len(approved), "directory": str(backup_dir)}

    def _task_cleanup_rejected(self) -> Dict[str, Any]:
        """Cleanup old rejected tools."""
        # For now, just count rejected - could delete old ones
        from backend.agent.generated_tools.registry import registry

        # This is a placeholder - in production would delete old rejected tools
        return {"message": "Cleanup simulated", "rejected_count": 0}

    def _task_update_analytics(self) -> Dict[str, Any]:
        """Update cached analytics."""
        from backend.agent.generated_tools.registry import registry

        stats = registry.get_stats()
        return {"stats": stats}


# Singleton
scheduler_manager = SchedulerManager()
