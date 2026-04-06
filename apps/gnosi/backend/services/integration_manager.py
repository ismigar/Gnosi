import json
import logging
from pathlib import Path
from backend.config.app_config import load_params

log = logging.getLogger(__name__)


class IntegrationManager:
    def __init__(self):
        cfg = load_params(strict_env=False)
        self.secrets_dir = cfg.paths["SECRETS"]
        self.secrets_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.secrets_dir / "integrations.json"

    def _load(self) -> dict:
        log.info(
            f"Loading integrations from: {self.config_file}, exists: {self.config_file.exists()}"
        )
        if not self.config_file.exists():
            return {}
        try:
            with open(self.config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.error(f"Error loading integrations: {e}")
            return {}

    def _save(self, data: dict):
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            log.error(f"Error saving integrations: {e}")
            raise e

    def _mask_dict(self, d: dict) -> dict:
        safe_d = {}
        for k, v in d.items():
            if (
                "password" in k.lower()
                or "token" in k.lower()
                or "key" in k.lower()
                or "secret" in k.lower()
            ):
                if v:
                    safe_d[k] = (
                        "********" + str(v)[-4:] if len(str(v)) > 8 else "********"
                    )
                    safe_d[f"{k}_status"] = "connected"
                else:
                    safe_d[k] = ""
                    safe_d[f"{k}_status"] = "disconnected"
            else:
                safe_d[k] = v
        return safe_d

    def get_all_safe(self) -> dict:
        """Returns the config without raw passwords/tokens, only showing connection status and hints."""
        config = self._load()
        safe_config = {}
        for key, value in config.items():
            if isinstance(value, list):
                # Mask each dict in the list
                safe_config[key] = [
                    self._mask_dict(item) if isinstance(item, dict) else item
                    for item in value
                ]
            elif isinstance(value, dict):
                safe_config[key] = self._mask_dict(value)
            else:
                safe_config[key] = value
        return safe_config

    def get_raw(self, key: str):
        """Internal method to get real credentials"""
        return self._load().get(key, {} if not key.endswith("s") else [])

    def _merge_dict(self, old_d: dict, new_d: dict) -> dict:
        merged = old_d.copy()
        for k, v in new_d.items():
            if v and isinstance(v, str) and v.startswith("********"):
                continue  # Keep the old one
            merged[k] = v
        return merged

    def _update_single_key(self, config: dict, key: str, data):
        """Internal helper to update a single key in the dictionary without saving."""
        if isinstance(data, list):
            # Expecting a list of dicts with 'id'. Merge by ID.
            old_list = config.get(key, [])
            if not isinstance(old_list, list):
                old_list = []

            old_dict = {
                item.get("id"): item
                for item in old_list
                if isinstance(item, dict) and "id" in item
            }

            new_list = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                item_id = item.get("id")
                if not item_id:
                    import uuid

                    item["id"] = str(uuid.uuid4())
                    new_list.append(item)
                elif item_id in old_dict:
                    new_list.append(self._merge_dict(old_dict[item_id], item))
                else:
                    new_list.append(item)

            config[key] = new_list
        else:
            old_d = config.get(key, {})
            if not isinstance(old_d, dict):
                old_d = {}
            config[key] = self._merge_dict(old_d, data)

    def update(self, key: str, data):
        """Updates a specific integration configuration."""
        config = self._load()
        self._update_single_key(config, key, data)
        self._save(config)

    def bulk_update(self, updates: dict):
        """Updates multiple integration keys and saves once."""
        config = self._load()
        for key, data in updates.items():
            self._update_single_key(config, key, data)
        self._save(config)



integration_manager = IntegrationManager()
