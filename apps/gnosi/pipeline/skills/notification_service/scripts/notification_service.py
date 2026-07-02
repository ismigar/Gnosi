import os
import subprocess
import logging
from datetime import datetime
from pathlib import Path
from abc import ABC, abstractmethod
from typing import Optional

import sys
from pathlib import Path

import sys
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parents[4]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Gnosi Imports
try:
    from backend.data.management_db import get_mgmt_session
    from backend.models.notification import Notification
    from backend.config.app_config import load_params
except ImportError:
    print(f"Warning: Could not import backend modules from {BASE_DIR}. Path might be wrong.")
    get_mgmt_session = None
    Notification = None
    load_params = None

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')
log = logging.getLogger("notif_service")

class BaseNotificationChannel(ABC):
    @abstractmethod
    def send(self, title: str, message: str, level: str = "INFO", workspace_id: str = "default") -> bool:
        pass

class DBChannel(BaseNotificationChannel):
    def send(self, title: str, message: str, level: str = "INFO", workspace_id: str = "default") -> bool:
        if not get_mgmt_session or not Notification:
            log.warning("DB Channel not available: models or session helper not found.")
            return False
            
        db = get_mgmt_session()
        try:
            notif = Notification(
                workspace_id=workspace_id,
                title=title,
                message=message,
                level=level
            )
            db.add(notif)
            db.commit()
            return True
        except Exception as e:
            log.error(f"Failed to save notification to DB: {e}")
            db.rollback()
            return False
        finally:
            db.close()

class MDChannel(BaseNotificationChannel):
    def __init__(self):
        self.log_file = None
        self._initialized = False

    def _init_paths(self):
        if self._initialized: return

        try:
            cfg = load_params(strict_env=False)
            # Local-only: les notificacions són per-instància; escriure-les a
            # un fitxer al vault sincronitzat (OneDrive) duplicava entries
            # entre dispositius. LOCAL_DATA viu dins el container Docker i
            # és per-instància — la ubicació correcta per a logs operatius.
            local_data = cfg.paths.get("LOCAL_DATA")
            if not local_data:
                # Fallback raonable per execucions fora de Docker (host). Derivem el
                # path del vault de l'entorn en comptes de hardcodejar un usuari macOS
                # (que trencava en l'altra màquina): VAULT_HOST_PATH si està definida,
                # si no la ruta canònica dins $HOME (HOME_HOST_PATH o Path.home()).
                host_home = os.environ.get("HOME_HOST_PATH") or str(Path.home())
                default_vault = Path(host_home) / "Library/CloudStorage/OneDrive-UNED/Gnosi"
                vault_p = cfg.paths.get("VAULT") or Path(
                    os.environ.get("VAULT_HOST_PATH") or default_vault
                )
                local_data = Path(vault_p) / ".gnosi"

            self.log_file = Path(local_data) / "logs" / "notifications.md"
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            
            if not self.log_file.exists():
                header = "# Gnosi System Notifications\n\n| Timestamp | Level | Title | Message |\n| --- | --- | --- | --- |\n"
                self.log_file.write_text(header, encoding="utf-8")
            self._initialized = True
        except Exception as e:
            log.error(f"Failed to initialize MD channel paths: {e}")

    def send(self, title: str, message: str, level: str = "INFO", workspace_id: str = "default") -> bool:
        self._init_paths()
        if not self.log_file: return False
        
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        # Sanitize message for markdown table
        msg_clean = message.replace("|", "\\|").replace("\n", " ")
        row = f"| {ts} | {level} | {title} | {msg_clean} |\n"
        
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(row)
            return True
        except Exception as e:
            log.error(f"Failed to write notification to Markdown: {e}")
            return False

class MacOSChannel(BaseNotificationChannel):
    def send(self, title: str, message: str, level: str = "INFO", workspace_id: str = "default") -> bool:
        try:
            msg_clean = message.replace('"', '\\"')
            title_clean = title.replace('"', '\\"')
            cmd = f'display notification "{msg_clean}" with title "{title_clean}"'
            subprocess.run(["osascript", "-e", cmd], check=True)
            return True
        except Exception:
            return False

class NotificationDispatcher:
    def __init__(self):
        self.channels = {
            "db": DBChannel(),
            "md": MDChannel(),
            "os": MacOSChannel()
        }

    def notify(self, title: str, message: str, level: str = "INFO", workspace_id: str = "default"):
        log.info(f"Broadcasting notification: {title} [{level}]")
        for name, channel in self.channels.items():
            try:
                channel.send(title, message, level, workspace_id)
            except Exception as e:
                log.error(f"Error in channel '{name}': {e}")

_dispatcher = NotificationDispatcher()

def notify(title: str, message: str, level: str = "INFO", workspace_id: str = "default"):
    _dispatcher.notify(title, message, level, workspace_id)

if __name__ == "__main__":
    # Test
    notify("Prueba Dual", "Notificación persistida en BD y MD con éxito.", level="SUCCESS")
