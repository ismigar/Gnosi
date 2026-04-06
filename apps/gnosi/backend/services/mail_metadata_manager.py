import json
import logging
from pathlib import Path
from backend.config.app_config import load_params

log = logging.getLogger(__name__)


class MailMetadataManager:
    def __init__(self):
        cfg = load_params(strict_env=False)
        self.secrets_dir = cfg.paths["SECRETS"]
        self.secrets_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.secrets_dir / "mail_metadata.json"

    def _load(self) -> dict:
        if not self.config_file.exists():
            return {}
        try:
            return json.loads(self.config_file.read_text(encoding="utf-8"))
        except Exception as e:
            log.error(f"Error loading mail metadata: {e}")
            return {}

    def _save(self, data: dict):
        try:
            self.config_file.write_text(json.dumps(data, indent=4), encoding="utf-8")
        except Exception as e:
            log.error(f"Error saving mail metadata: {e}")

    def get_metadata(self, thread_id: str) -> dict:
        return self._load().get(thread_id, {})

    def update_metadata(self, thread_id: str, new_metadata: dict):
        data = self._load()
        if thread_id not in data:
            data[thread_id] = {}
        data[thread_id].update(new_metadata)
        self._save(data)
        return data[thread_id]


mail_metadata_manager = MailMetadataManager()
