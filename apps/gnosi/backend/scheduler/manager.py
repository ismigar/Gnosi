"""
Scheduler Manager: Manages scheduled tasks using APScheduler.
"""

import json
import os
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict
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
    interval_minutes: float
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
        "zotero_sync": {
            "description": "Sincronització bidireccional Zotero ↔ Vault",
            "default_interval": 60,  # 1 hour
        },
        "purge_trash": {
            "description": "Buida la paperera del Vault (entrades > 90 dies)",
            "default_interval": 1440,  # 24 hours
        },
        "publish_scheduled_social": {
            "description": "Publica les publicacions socials programades vençudes",
            "default_interval": 5,  # 5 minutes
        },
        "materialize_view_snapshots": {
            "description": "Materialitza els snapshots de vistes al markdown (migració portable)",
            "default_interval": 1440,  # 24 hours
        },
        "meeting_reminders": {
            "description": "Avisos de reunions properes amb ordre del dia (IA)",
            "default_interval": 1,  # cada minut
            # quiet: NO emetre les notificacions "Tasca Iniciada/Finalitzada"
            # (correria cada minut i ompliria macOS de bombolles). Els avisos
            # reals de reunió els envia el propi servei.
            "quiet": True,
        },
    }

    def __init__(self):
        cfg = load_params(strict_env=False)
        self.config_path = cfg.paths.get("SCHEDULER")

        # Mirror local del scheduler_config: SEMPRE llegible, immune a OneDrive
        # online-only. És la xarxa de seguretat que evita perdre la config quan
        # el fitxer del vault (.gnosi/) és dataless en arrencar. Viu a
        # local_data, com management.sqlite (vegeu paths_config.py).
        local_data = cfg.paths.get("LOCAL_DATA")
        self.local_mirror_path = (
            local_data / "system" / "scheduler_config.local.json"
            if local_data else None
        )

        for p in (self.config_path, self.local_mirror_path):
            if p:
                try:
                    p.parent.mkdir(parents=True, exist_ok=True)
                except Exception:
                    pass

        self._tasks: Dict[str, ScheduledTask] = {}
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock_file = None  # held while scheduler owns the singleton mutex
        self._degraded = False  # True si arrenquem sense poder llegir cap font

        self._load_config()

    @staticmethod
    def _try_read_tasks(path) -> Optional[Dict[str, Any]]:
        """Llegeix i parseja un fitxer de config de tasques.

        Retorna el dict {name: task_data} si el fitxer existeix, és llegible i
        conté tasques; None en qualsevol altre cas (inexistent, buit,
        dataless/online-only, JSON corrupte). Reintenta unes quantes vegades
        perquè OneDrive sovint serveix un fitxer online-only només al 2n intent.
        """
        if not path or not path.exists():
            return None
        import time as _time
        for attempt in range(3):
            try:
                with open(path) as f:
                    data = json.load(f)
                tasks = data.get("tasks", {})
                return tasks or None  # JSON vàlid però sense tasques -> buit
            except Exception:
                _time.sleep(0.5 * (attempt + 1))  # backoff curt per dataless
        return None

    def _reconcile_available_tasks(self) -> bool:
        """Elimina tasques obsoletes i afegeix les noves de AVAILABLE_TASKS.

        Retorna True si hi ha hagut algun canvi."""
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
                    enabled=False,
                )
                updated = True
        return updated

    def _load_config(self):
        """Carrega la config del planificador de manera resilient.

        Ordre de preferència:
          1. Fitxer del vault (`.gnosi/`, sincronitzat entre màquines).
          2. Mirror local (`local_data/`, sempre llegible, immune a OneDrive).
          3. Defaults EN MEMÒRIA — només si cap font no existeix.

        CRÍTIC: si el fitxer del vault EXISTEIX però ara mateix no es pot llegir
        (online-only/dataless/corrupte), MAI l'inicialitzem amb defaults ni el
        sobreescrivim. Així mai es perd la config de l'usuari per un problema
        transitori de OneDrive — abans, aquest era el camí que buidava el
        planificador (vegeu directive scheduler_config_resilience).
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
                    pass  # ignora claus desconegudes / formats antics
            self._reconcile_available_tasks()
            log.info(
                f"⏰ Scheduler: config carregada des de {source} "
                f"({len(self._tasks)} tasques)"
            )
            # No reescrivim el vault a l'arrencada (evita churn/conflictes de
            # OneDrive); només refresquem el mirror local amb el que hem llegit.
            self._save_mirror()
            return

        # Cap font llegible.
        vault_exists = bool(self.config_path and self.config_path.exists())
        mirror_exists = bool(self.local_mirror_path and self.local_mirror_path.exists())
        if vault_exists or mirror_exists:
            # El fitxer existeix però és il·legible ARA. NO el toquem: arrenquem
            # en mode degradat amb defaults EN MEMÒRIA (sense persistir), per no
            # destruir la config bona. Es recuperarà al proper restart llegible.
            log.error(
                "❌ Scheduler: el fitxer de config existeix però és il·legible "
                "(online-only/corrupte). Mode degradat: defaults en memòria, "
                "NO se sobreescriu cap fitxer."
            )
            self._degraded = True
            self._init_default_tasks(persist=False)
        else:
            log.info("⏰ Scheduler: cap config trobada; creant defaults.")
            self._init_default_tasks(persist=True)

    def _init_default_tasks(self, persist: bool = True):
        """Initialize with default tasks (all disabled).

        `persist=False` deixa els defaults només en memòria — usat en mode
        degradat per no sobreescriure un fitxer existent però il·legible.
        """
        for name, config in self.AVAILABLE_TASKS.items():
            self._tasks[name] = ScheduledTask(
                name=name,
                description=config["description"],
                interval_minutes=config["default_interval"],
                enabled=False,  # Disabled by default
            )
        if persist:
            self._save_config()

    def _save_config(self):
        """Persisteix la config al vault i SEMPRE al mirror local.

        En mode degradat NO escrivim el vault (preservem el fitxer existent que
        ara no podem llegir), però sí el mirror local perquè la sessió actual
        no perdi els canvis.
        """
        from backend.utils.safe_io import safe_write_json

        data = {"tasks": {name: asdict(task) for name, task in self._tasks.items()}}

        if self.config_path and not self._degraded:
            try:
                # Atomic write: el fitxer es modifica desenes de cops per
                # execució de tasca; un crash a meitat deixaria el JSON corrupte.
                safe_write_json(self.config_path, data, indent=2)
            except Exception as e:
                from backend.config.logger_config import get_logger
                get_logger(__name__).error(
                    f"Failed to save scheduler config to {self.config_path}: {e}"
                )

        self._save_mirror(data)

    def _save_mirror(self, data: Optional[Dict[str, Any]] = None):
        """Escriu el mirror local (sempre llegible; immune a OneDrive)."""
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

        # File-based mutex: prevent multiple scheduler instances on the same
        # host from racing on the same tasks (duplicate mail fetches, racing
        # filesystem cleanups, etc.). For a multi-host deployment this would
        # need to be replaced with a distributed lock (Redis, DB advisory).
        try:
            import fcntl
        except ImportError:
            fcntl = None  # Non-POSIX; fall back to in-process singleton only.

        # El lock viu a local_data (NO al vault): un flock sobre un fitxer de
        # OneDrive/virtiofs no s'allibera de manera fiable quan el procés mor,
        # i cada --reload hi deixava un lock fantasma -> el loop no arrencava
        # MAI ("Another scheduler already holds..."). En disc local funciona bé.
        lock_dir = (
            self.local_mirror_path.parent if self.local_mirror_path
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
        self, name: str, interval_minutes: float, enabled: bool
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
        except Exception as _e:
            from backend.config.logger_config import get_logger
            get_logger(__name__).warning(f"Could not clear task history: {_e}")

        return {"success": True, "message": "Scheduler history cleared"}

    def run_task_now(self, name: str) -> Dict[str, Any]:
        """Run a task immediately."""
        if name not in self._tasks:
            raise ValueError(f"Task '{name}' not found")

        task = self._tasks[name]
        task.status = "running"
        task.last_run = datetime.now().isoformat()

        # Tasques "quiet" (p.ex. meeting_reminders, cada minut) NO emeten les
        # notificacions d'inici/fi: omplirien macOS de bombolles. Els seus avisos
        # propis (si en tenen) els gestiona el servei.
        quiet = bool(self.AVAILABLE_TASKS.get(name, {}).get("quiet"))

        # Log task start
        if not quiet:
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
                except Exception as _e:
                    # Don't crash the scheduler over a bookkeeping error,
                    # but log so a corrupt task_history DB shows up in logs.
                    from backend.config.logger_config import get_logger
                    get_logger(__name__).warning(
                        f"Could not persist task history for {name}: {_e}"
                    )

            if not quiet:
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
                except Exception as _e:
                    # Don't crash the scheduler over a bookkeeping error,
                    # but log so a corrupt task_history DB shows up in logs.
                    from backend.config.logger_config import get_logger
                    get_logger(__name__).warning(
                        f"Could not persist task history for {name}: {_e}"
                    )

            if not quiet:
                notify(
                    f"Error en Tasca: {name.replace('_', ' ').title()}",
                    f"S'ha produït un error en l'execució: {error_msg}",
                    level="ERROR"
                )

            task.status = "error"
            self._save_config()
            return {"success": False, "error": error_msg}

    def _task_publish_scheduled_social(self) -> Dict[str, Any]:
        """Publica les publicacions socials programades que ja han vençut.

        Reaprofita l'endpoint async `process_scheduled_posts`. El job corre en un
        thread del scheduler sense event loop, així que `asyncio.run` és segur; si
        excepcionalment ja n'hi hagués un, l'executem en un thread propi.
        """
        import asyncio
        from fastapi import BackgroundTasks
        from backend.api.social_routes import process_scheduled_posts

        def _runner():
            return asyncio.run(process_scheduled_posts(BackgroundTasks()))

        try:
            return _runner()
        except RuntimeError:
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                return ex.submit(_runner).result()

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
        elif name == "zotero_sync":
            return self._task_zotero_sync()
        elif name == "purge_trash":
            return self._task_purge_trash()
        elif name == "publish_scheduled_social":
            return self._task_publish_scheduled_social()
        elif name == "materialize_view_snapshots":
            return self._task_materialize_view_snapshots()
        elif name == "meeting_reminders":
            return self._task_meeting_reminders()

        return {"error": f"Unknown task: {name}"}

    def _task_purge_trash(self) -> Dict[str, Any]:
        """Purga entrades de la paperera del Vault amb antiguitat > 90 dies.

        La lògica viu a `backend/api/vault_routes.py::purge_expired_trash`
        perquè comparteix helpers amb els endpoints HTTP.
        """
        from backend.api.vault_routes import purge_expired_trash

        return purge_expired_trash()

    def _task_materialize_view_snapshots(self) -> Dict[str, Any]:
        """Materialitza els snapshots de vistes al markdown de tot el vault
        perquè la migració sigui real (vistes = taules/llistes navegables sense
        Gnosi). Reescriu només les pàgines amb snapshot endarrerit.

        La lògica viu a `backend/api/vault_routes.py::refresh_view_snapshots`
        perquè comparteix els helpers del snapshot.
        """
        from backend.api.vault_routes import refresh_view_snapshots

        return refresh_view_snapshots()

    def _task_meeting_reminders(self) -> Dict[str, Any]:
        """Escaneja reunions properes i n'envia avisos amb ordre del dia (IA).

        La lògica viu a `backend/services/meeting_reminders.py`. Tasca "quiet":
        corre cada minut i NO emet notificacions d'inici/fi.
        """
        from backend.services.meeting_reminders import scan_and_notify

        return scan_and_notify()

    def _task_fetch_mail(self) -> Dict[str, Any]:
        """Sync mail from all configured accounts (Gmail + IMAP)."""
        from backend.services.integration_manager import integration_manager
        from backend.services.vault_mail_sync_service import sync_service
        from backend.services.imap_mail_sync_service import imap_sync_service

        total = 0
        details = []
        seen: set = set()
        for acc in integration_manager.get_all_mail_accounts(only_enabled=True):
            email = acc.get("email") or acc.get("username")
            if not email or email in seen:
                continue
            seen.add(email)
            try:
                if integration_manager.is_imap_account(acc):
                    count = imap_sync_service.sync_account(email, limit=50)
                elif integration_manager.is_microsoft_account(acc):
                    count = 0  # Microsoft Graph és live — no cal sync al vault
                else:
                    count = sync_service.sync_emails(email, limit=50)
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

        # Arrel de l'app Gnosi derivada d'aquest fitxer (backend/scheduler/manager.py):
        # parents[2] = .../monorepo/apps/gnosi al host i /app dins el contenidor (mateixa
        # derivació que _task_zotero_sync). Abans s'usava cfg.paths["PROJECT_DIR"] /
        # "monorepo/apps/gnosi/pipeline", però dins Docker PROJECT_DIR és /app i això
        # resolia a /app/monorepo/apps/gnosi/pipeline (inexistent; el pipeline real és
        # /app/pipeline) → les neteges de logs, sandbox i .tmp eren no-ops silencioses.
        gnosi_root = Path(__file__).resolve().parents[2]
        pipeline_base = gnosi_root / "pipeline"

        # 1. Purge Logs
        log_dir = cfg.paths.get("LOG_DIR")
        if log_dir and log_dir.exists():
            log_patterns = [str(log_dir / "*.log"), str(log_dir.parent / "*.log")]
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
        # L'arxiu del mailbox de l'equip viu a `{arrel_repo}/.antigravity/team/mailbox/archive`
        # (vegeu pipeline/brain/orchestrator.py i monorepo/AGENTS.md). El docker-compose el
        # munta a la MATEIXA ruta absoluta host↔contenidor via `${REPO_ROOT:-$HOME/Projectes}`,
        # així que derivem la base de REPO_ROOT (fallback: HOME_HOST_PATH/Projectes) per coincidir
        # amb el mount. NO usem PROJECT_DIR: dins el contenidor és `/app`, on no hi ha el mount.
        repo_root_env = os.environ.get("REPO_ROOT")
        if repo_root_env:
            repo_root = Path(repo_root_env)
        else:
            host_home = os.environ.get("HOME_HOST_PATH") or str(Path.home())
            repo_root = Path(host_home) / "Projectes"
        mailbox_archive = repo_root / ".antigravity" / "team" / "mailbox" / "archive"
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
        pipeline_dirs = [pipeline_base / "sandbox", pipeline_base / ".tmp"]

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

        # 4. Cleanup Pycache (només dirs de codi: backend i pipeline; evitem fer walk
        # sobre /app/data, el volum local de dades amb SQLite/índexs).
        pycache_count = 0
        for code_dir in (gnosi_root / "backend", pipeline_base):
            if not code_dir.exists():
                continue
            for root, dirs, files in os.walk(code_dir):
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


    def _task_zotero_sync(self) -> Dict[str, Any]:
        """Bidirectional Zotero ↔ Vault sync. Skips Vault→Zotero if Zotero is open."""
        import subprocess
        from pathlib import Path
        from backend.config.logger_config import get_logger
        log = get_logger(__name__)

        base = Path(__file__).resolve().parents[2]
        scripts = base / "pipeline/skills/zotero_sync/scripts"

        # Check config enabled
        config_path = base / "pipeline/skills/zotero_sync/zotero_db_config.json"
        try:
            import json
            config = json.loads(config_path.read_text())
            if not config.get("enabled"):
                return {"message": "Zotero integration disabled — skipped"}
        except Exception as e:
            return {"success": False, "error": f"Could not read Zotero config: {e}"}

        results = {}

        # Subprocess timeout — sense això, un script penjat (Zotero DB
        # lock, network hang) bloqueja l'scheduler indefinidament.
        # 5 min és suficient per syncs grans.
        SUBPROCESS_TIMEOUT = 300
        # Zotero → Vault
        try:
            r = subprocess.run(
                ["python3", str(scripts / "zotero_to_vault.py")],
                capture_output=True, text=True, cwd=str(base),
                timeout=SUBPROCESS_TIMEOUT,
            )
            results["zotero_to_vault"] = "ok" if r.returncode == 0 else r.stderr.strip()
        except subprocess.TimeoutExpired:
            results["zotero_to_vault"] = f"timeout after {SUBPROCESS_TIMEOUT}s"
        except Exception as e:
            results["zotero_to_vault"] = str(e)

        # Vault → Zotero (only if Zotero is closed)
        try:
            zotero_open = subprocess.run(
                ["pgrep", "-x", "Zotero"], capture_output=True, timeout=5,
            ).returncode == 0
        except subprocess.TimeoutExpired:
            zotero_open = False  # pgrep penjat: assumim tancat i procedim
        if zotero_open:
            results["vault_to_zotero"] = "skipped — Zotero is open"
            log.info("⏰ Zotero sync: Vault→Zotero skipped (Zotero is running)")
        else:
            try:
                r = subprocess.run(
                    ["python3", str(scripts / "gnosi_to_zotero.py")],
                    capture_output=True, text=True, cwd=str(base),
                    timeout=SUBPROCESS_TIMEOUT,
                )
                results["vault_to_zotero"] = "ok" if r.returncode == 0 else r.stderr.strip()
            except subprocess.TimeoutExpired:
                results["vault_to_zotero"] = f"timeout after {SUBPROCESS_TIMEOUT}s"
            except Exception as e:
                results["vault_to_zotero"] = str(e)

        return {"success": True, "message": "Zotero sync completed", "details": results}


# Singleton
scheduler_manager = SchedulerManager()
