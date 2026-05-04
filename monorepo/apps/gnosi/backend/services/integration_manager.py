import json
import logging
import threading
from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_json

log = logging.getLogger(__name__)


class IntegrationManager:
    def __init__(self):
        cfg = load_params(strict_env=False)
        self.secrets_dir = cfg.paths["SECRETS"]
        self.secrets_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.secrets_dir / "integrations.json"
        self._cache = None
        self._cache_mtime = 0
        # Read-modify-write lock: dues operacions concurrents (ex. dos
        # tabs guardant credencials, sync que toca tokens i UI alhora)
        # poden perdre updates si llegeixen el mateix snapshot.
        self._lock = threading.RLock()

    def _load(self) -> dict:
        """Loads from disk only if needed."""
        if not self.config_file.exists():
            return {}
        
        try:
            mtime = self.config_file.stat().st_mtime
            if self._cache is not None and mtime <= self._cache_mtime:
                return self._cache
        except Exception:
            pass

        try:
            with open(self.config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._cache = data
                try:
                    self._cache_mtime = self.config_file.stat().st_mtime
                except Exception:
                    self._cache_mtime = 0
                return data
        except Exception as e:
            log.error(f"Error loading integrations from {self.config_file}: {e}")
            return {}
        
        return data if isinstance(data, dict) else {}

    def _save(self, data: dict):
        try:
            # Atomic write: integrations.json conté TOTES les credencials.
            # Un crash a meitat de json.dump deixaria el fitxer truncat i
            # totes les integracions deixarien de funcionar al següent restart.
            safe_write_json(self.config_file, data, indent=4)
            # Update cache immediately
            self._cache = data
            try:
                self._cache_mtime = self.config_file.stat().st_mtime
            except Exception:
                self._cache_mtime = 0
        except Exception as e:
            log.error(f"Error saving integrations: {e}")
            # `raise` (no `raise e`) preserva el traceback original
            raise

    def _mask_dict(self, d: dict) -> dict:
        safe_d = {}
        for k, v in d.items():
            # Camps de tipus _status no son sensibles (son metadades de connexió)
            if k.endswith("_status"):
                safe_d[k] = v
                continue

            is_sensitive = (
                "password" in k.lower()
                or "token" in k.lower()
                or "key" in k.lower()
                or "secret" in k.lower()
            )

            if is_sensitive:
                if v:
                    safe_d[k] = (
                        "********" + str(v)[-4:] if len(str(v)) > 8 else "********"
                    )
                    status_key = f"{k}_status"
                    if status_key not in d:
                        safe_d[status_key] = "connected"
                else:
                    safe_d[k] = ""
                    status_key = f"{k}_status"
                    if status_key not in d:
                        safe_d[status_key] = "disconnected"
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
            # If the list contains non-dict items, replace entirely
            if any(not isinstance(item, dict) for item in data):
                config[key] = data
                return

            # Expecting a list of dicts with 'id'. Merge by ID.
            old_list = config.get(key, [])
            if not isinstance(old_list, list):
                old_list = []

            # Create a map of existing items by ID
            merged_dict = {
                item.get("id"): item
                for item in old_list
                if isinstance(item, dict) and "id" in item
            }

            # Update with new items
            for item in data:
                if not isinstance(item, dict):
                    continue
                item_id = item.get("id")
                if not item_id:
                    import uuid
                    item_id = str(uuid.uuid4())
                    item["id"] = item_id
                
                if item_id in merged_dict:
                    merged_dict[item_id] = self._merge_dict(merged_dict[item_id], item)
                else:
                    merged_dict[item_id] = item

            config[key] = list(merged_dict.values())
        else:
            old_val = config.get(key)
            if isinstance(data, dict) and (isinstance(old_val, dict) or old_val is None):
                config[key] = self._merge_dict(old_val or {}, data)
            else:
                # Direct replacement for primitive types (strings, bools, etc.)
                config[key] = data

    def update(self, key: str, data):
        """Updates a specific integration configuration."""
        with self._lock:
            config = self._load()
            self._update_single_key(config, key, data)
            self._save(config)

    def replace_key(self, key: str, value):
        """Reemplaça completament el valor de `key` (sense merge per ID).

        A diferència de `update()` que fa merge intel·ligent per llista
        d'items amb `id`, aquest mètode és útil per coleccions on l'usuari
        vol reemplaç total (p.ex. social_streams editats a la UI: si un
        stream s'elimina, el merge per ID el mantindria ressuscitat).
        """
        with self._lock:
            config = self._load()
            config[key] = value
            self._save(config)

    def bulk_update(self, updates: dict):
        """Updates multiple integration keys and saves once."""
        with self._lock:
            config = self._load()
            for key, data in updates.items():
                self._update_single_key(config, key, data)
            self._save(config)

    # ── Mail account helpers ───────────────────────────────────────────────────

    def get_all_mail_accounts(self, only_enabled: bool = False) -> list:
        """Returns all mail accounts (raw) from both 'emails' and 'mail_accounts'."""
        data = self._load()
        accounts = data.get("emails", []) + data.get("mail_accounts", [])
        if only_enabled:
            accounts = [a for a in accounts if a.get("enabled", True)]
        return accounts

    def set_mail_account_enabled(self, email: str, enabled: bool) -> bool:
        """Sets the enabled flag for a mail account. Returns True if found."""
        with self._lock:
            data = self._load()
            email_lower = email.strip().lower()
            for section in ("emails", "mail_accounts"):
                for acc in data.get(section, []):
                    if (acc.get("email") or acc.get("username", "")).strip().lower() == email_lower:
                        acc["enabled"] = enabled
                        self._save(data)
                        return True
            return False

    def get_mail_account(self, email: str) -> dict | None:
        """Returns the raw account dict for an email, searching both lists."""
        email_lower = email.strip().lower()
        for acc in self.get_all_mail_accounts():
            if (acc.get("email") or acc.get("username", "")).strip().lower() == email_lower:
                return acc
        return None

    def get_account_by_alias(self, alias_email: str) -> dict | None:
        """Returns the parent account that owns the given alias email, or None."""
        alias_lower = alias_email.strip().lower()
        for acc in self.get_all_mail_accounts():
            for alias in acc.get("aliases", []):
                if alias.get("email", "").strip().lower() == alias_lower:
                    return acc
        return None

    def update_mail_account_token(self, email: str, token: str) -> None:
        """Persists a refreshed OAuth token in-place without touching other fields."""
        with self._lock:
            data = self._load()
            email_lower = email.strip().lower()
            for section in ("emails", "mail_accounts"):
                for acc in data.get(section, []):
                    if (acc.get("email") or acc.get("username", "")).strip().lower() == email_lower:
                        acc["token"] = token
                        self._save(data)
                        return

    # ── Provider classification (static, no I/O) ──────────────────────────────

    @staticmethod
    def is_google_account(acc: dict) -> bool:
        """True for Google OAuth2 accounts (use Gmail API)."""
        return bool(
            acc
            and acc.get("provider") == "google"
            and acc.get("auth_type") == "oauth2"
        )

    @staticmethod
    def is_microsoft_account(acc: dict) -> bool:
        """True for Microsoft 365 / Entra ID OAuth2 accounts (use Graph API)."""
        return bool(
            acc
            and acc.get("provider") == "microsoft"
            and acc.get("auth_type") == "oauth2"
        )

    @staticmethod
    def is_imap_account(acc: dict) -> bool:
        """True for any account that should be accessed via IMAP.

        Includes manual, Outlook, and any account with imap_host that is not
        Google OAuth2.
        """
        if not acc:
            return False
        if IntegrationManager.is_google_account(acc):
            return False
        provider = acc.get("provider", "")
        return provider in ("manual", "outlook", "imap") or bool(acc.get("imap_host"))

    @staticmethod
    def resolve_imap_defaults(acc: dict) -> dict:
        """Returns the account dict with default IMAP settings filled in for
        known providers (e.g. Outlook) when the caller hasn't set them explicitly."""
        provider = acc.get("provider", "")
        if provider == "outlook" and not acc.get("imap_host"):
            acc = {
                **acc,
                "imap_host": "outlook.office365.com",
                "imap_port": acc.get("imap_port") or 993,
                "imap_encryption": acc.get("imap_encryption") or "ssl",
                "imap_user": acc.get("imap_user") or acc.get("email", ""),
            }
        return acc


integration_manager = IntegrationManager()
