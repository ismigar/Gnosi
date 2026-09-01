import json
import logging
import threading
from pathlib import Path
from typing import Any, TypeAlias

from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_json

log = logging.getLogger(__name__)
Metadata: TypeAlias = dict[str, Any]
MetadataStore: TypeAlias = dict[str, Metadata]


class MailMetadataManager:
    def __init__(self, config_file: Path | None = None) -> None:
        if config_file is None:
            cfg = load_params(strict_env=False)
            secrets_dir = cfg.paths.get("SECRETS")
            if secrets_dir is None:
                raise RuntimeError("Gnosi mail metadata requires a SECRETS path")
            secrets_dir.mkdir(parents=True, exist_ok=True)
            config_file = secrets_dir / "mail_metadata.json"
        else:
            config_file.parent.mkdir(parents=True, exist_ok=True)
        self.config_file = config_file
        # Read-modify-write lock: two concurrent writes (for example, two
        # tabs marking read at the same time) could lose updates if they read
        # the same snapshot before writing.
        self._lock = threading.Lock()

    def _load(self) -> MetadataStore:
        if not self.config_file.exists():
            return {}
        try:
            payload: Any = json.loads(self.config_file.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("mail metadata root must be an object")
            return {
                str(thread_id): dict(metadata)
                for thread_id, metadata in payload.items()
                if isinstance(metadata, dict)
            }
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
            log.error("Error loading mail metadata: %s", exc)
            return {}

    def _save(self, data: MetadataStore) -> None:
        try:
            safe_write_json(self.config_file, data, indent=4)
        except OSError as exc:
            log.error("Error saving mail metadata: %s", exc)

    def get_metadata(self, thread_id: str) -> Metadata:
        return self._load().get(thread_id, {})

    def update_metadata(self, thread_id: str, new_metadata: Metadata) -> Metadata:
        with self._lock:
            data = self._load()
            if thread_id not in data:
                data[thread_id] = {}
            data[thread_id].update(new_metadata)
            self._save(data)
            return dict(data[thread_id])


mail_metadata_manager = MailMetadataManager()
