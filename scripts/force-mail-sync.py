import os
import sys
from pathlib import Path

# Add the canonical repository root to sys.path in native and container runs.
GNOSI_ROOT = Path(__file__).resolve().parents[1]
if str(GNOSI_ROOT) not in sys.path:
    sys.path.insert(0, str(GNOSI_ROOT))

from backend.config.paths_config import get_paths
from backend.services.vault_mail_sync_service import VaultMailSyncService

# Force absolute vault path from env if possible
vault_env = os.environ.get("DIGITAL_BRAIN_VAULT_PATH", str(GNOSI_ROOT / "vault"))
print(f"DEBUG: DIGITAL_BRAIN_VAULT_PATH env is {vault_env}")

paths = get_paths()
print(f"DEBUG: Resolved VAULT path is {paths.get('VAULT')}")

sync_service = VaultMailSyncService()
# Override manually just in case
sync_service.vault_path = Path(paths.get('VAULT'))
sync_service.mail_folder = sync_service.vault_path / "Mail"
sync_service.mail_folder.mkdir(parents=True, exist_ok=True)

print(f"DEBUG: Syncing to {sync_service.mail_folder}")

count = sync_service.sync_emails("ismigar@gmail.com", limit=20)
print(f"DEBUG: Synced {count} messages.")
