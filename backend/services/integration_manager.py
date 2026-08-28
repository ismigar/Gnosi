from __future__ import annotations

import json
import hashlib
import logging
import threading
from pathlib import Path
from typing import Any

from backend.config.app_config import load_params
from backend.security.keychain_manager import get_keychain
from backend.utils.safe_io import safe_write_json

log = logging.getLogger(__name__)


class IntegrationManager:
    def __init__(self) -> None:
        cfg = load_params(strict_env=False)
        secrets_dir = cfg.paths["SECRETS"]
        if not isinstance(secrets_dir, Path):
            raise RuntimeError("Gnosi local secrets directory is unavailable")
        self.secrets_dir = secrets_dir
        self.secrets_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.secrets_dir / "integrations.json"
        self._cache: dict[str, Any] | None = None
        self._cache_mtime = 0.0
        # Read-modify-write lock: two concurrent operations (for example, two
        # tabs saving credentials, sync touching tokens, and UI all at once)
        # can lose updates if they read the same snapshot.
        self._lock = threading.RLock()

    @staticmethod
    def _is_sensitive_field(name: str) -> bool:
        normalized = str(name or "").lower()
        if normalized.endswith(("_status", "_uri", "_url")):
            return False
        return any(
            marker in normalized
            for marker in (
                "password",
                "secret",
                "token",
                "api_key",
                "private_key",
                "access_key",
            )
        )

    @staticmethod
    def _path_identity(item: Any, index: int) -> str:
        if isinstance(item, dict):
            for field in ("id", "email", "username", "name"):
                if item.get(field):
                    return str(item[field])
        return str(index)

    @staticmethod
    def _credential_key(path: tuple[str, ...]) -> str:
        digest = hashlib.sha256("/".join(path).encode("utf-8")).hexdigest()[:24]
        field = path[-1].lower().replace("-", "_")[:32]
        return f"integration_{digest}_{field}"

    def _externalize_secrets(self, value: Any, path: tuple[str, ...] = ()) -> tuple[Any, bool]:
        """Replace plaintext integration credentials with secure-store refs."""
        changed = False
        if isinstance(value, dict):
            secured_dict: dict[str, Any] = {}
            for key, item in value.items():
                current_path = (*path, str(key))
                if self._is_sensitive_field(key) and isinstance(item, str) and item:
                    if item.startswith("__keychain__:"):
                        secured_dict[key] = item
                        continue
                    credential_key = self._credential_key(current_path)
                    if not get_keychain().save_credential(credential_key, item):
                        raise RuntimeError(
                            f"Secure storage is unavailable for integration field {key}"
                        )
                    secured_dict[key] = f"__keychain__:{credential_key}"
                    changed = True
                    continue
                secured_dict[key], nested_changed = self._externalize_secrets(item, current_path)
                changed = changed or nested_changed
            return secured_dict, changed
        if isinstance(value, list):
            secured_list: list[Any] = []
            for index, item in enumerate(value):
                identity = self._path_identity(item, index)
                secured, nested_changed = self._externalize_secrets(item, (*path, identity))
                secured_list.append(secured)
                changed = changed or nested_changed
            return secured_list, changed
        return value, False

    def _resolve_secret_refs(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {key: self._resolve_secret_refs(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._resolve_secret_refs(item) for item in value]
        if isinstance(value, str) and value.startswith("__keychain__:"):
            return get_keychain().get_credential(value.split(":", 1)[1]) or ""
        return value

    @staticmethod
    def _collect_secret_refs(value: Any) -> set[str]:
        if isinstance(value, dict):
            refs = set()
            for item in value.values():
                refs.update(IntegrationManager._collect_secret_refs(item))
            return refs
        if isinstance(value, list):
            refs = set()
            for item in value:
                refs.update(IntegrationManager._collect_secret_refs(item))
            return refs
        if isinstance(value, str) and value.startswith("__keychain__:"):
            return {value.split(":", 1)[1]}
        return set()

    def _load_persisted(self) -> dict[str, Any]:
        """Load the reference-only integration document from disk."""
        if not self.config_file.exists():
            return {}

        try:
            mtime = self.config_file.stat().st_mtime
            if self._cache is not None and mtime <= self._cache_mtime:
                return dict(self._cache)
        except Exception:
            pass

        try:
            with open(self.config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    return {}
                typed_data = dict(data)
                self._cache = typed_data
                try:
                    self._cache_mtime = self.config_file.stat().st_mtime
                except Exception:
                    self._cache_mtime = 0.0
                return typed_data
        except Exception as e:
            log.error(f"Error loading integrations from {self.config_file}: {e}")
            return {}

        return {}

    def _load(self) -> dict[str, Any]:
        """Return resolved integration data, migrating legacy plaintext once."""
        with self._lock:
            persisted = self._load_persisted()
            secured, changed = self._externalize_secrets(persisted)
            if not isinstance(secured, dict):
                raise TypeError("persisted integration configuration must remain an object")
            if changed:
                self._write_persisted(secured)
                persisted = secured
            resolved = self._resolve_secret_refs(persisted)
            return dict(resolved) if isinstance(resolved, dict) else {}

    def _write_persisted(self, data: dict[str, Any]) -> None:
        safe_write_json(self.config_file, data, indent=4)
        self._cache = data
        try:
            self._cache_mtime = self.config_file.stat().st_mtime
        except Exception:
            self._cache_mtime = 0.0

    def _save(self, data: dict[str, Any]) -> None:
        try:
            previous_refs = self._collect_secret_refs(self._load_persisted())
            secured, _ = self._externalize_secrets(data)
            if not isinstance(secured, dict):
                raise TypeError("integration configuration must remain an object")
            self._write_persisted(secured)
            stale_refs = previous_refs - self._collect_secret_refs(secured)
            for credential_key in stale_refs:
                get_keychain().delete_credential(credential_key)
        except Exception as e:
            log.error(f"Error saving integrations: {e}")
            # `raise` (not `raise e`) preserves the original traceback
            raise

    def _mask_dict(self, d: dict[str, Any]) -> dict[str, Any]:
        safe_d: dict[str, Any] = {}
        for k, v in d.items():
            # Fields of type _status are not sensitive (they are connection metadata)
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
                    safe_d[k] = "********" + str(v)[-4:] if len(str(v)) > 8 else "********"
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

    def get_all_safe(self) -> dict[str, Any]:
        """Returns the config without raw passwords/tokens, only showing connection status and hints."""
        config = self._load()
        safe_config: dict[str, Any] = {}
        for key, value in config.items():
            if isinstance(value, list):
                # Mask each dict in the list
                safe_config[key] = [
                    self._mask_dict(item) if isinstance(item, dict) else item for item in value
                ]
            elif isinstance(value, dict):
                safe_config[key] = self._mask_dict(value)
            else:
                safe_config[key] = value
        return safe_config

    def get_raw(self, key: str) -> Any:
        """Internal method to get real credentials"""
        return self._load().get(key, {} if not key.endswith("s") else [])

    def _merge_dict(self, old_d: dict[str, Any], new_d: dict[str, Any]) -> dict[str, Any]:
        merged = old_d.copy()
        for k, v in new_d.items():
            if v and isinstance(v, str) and v.startswith("********"):
                continue  # Keep the old one
            merged[k] = v
        return merged

    def _update_single_key(self, config: dict[str, Any], key: str, data: Any) -> None:
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
                item.get("id"): item for item in old_list if isinstance(item, dict) and "id" in item
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

    def update(self, key: str, data: Any) -> None:
        """Updates a specific integration configuration."""
        with self._lock:
            config = self._load()
            self._update_single_key(config, key, data)
            self._save(config)

    def replace_key(self, key: str, value: Any) -> None:
        """Completely replaces the value of `key` (no merge by ID).

        Unlike `update()` which does a smart merge for a list
        of items with `id`, this method is useful for collections where the user
        wants a total replacement (e.g. social_streams edited in the UI: if a
        stream is removed, merging by ID would keep it resurrected).

        """
        with self._lock:
            config = self._load()
            config[key] = value
            self._save(config)

    def bulk_update(self, updates: dict[str, Any]) -> None:
        """Updates multiple integration keys and saves once."""
        with self._lock:
            config = self._load()
            for key, data in updates.items():
                self._update_single_key(config, key, data)
            self._save(config)

    # ── Mail account helpers ───────────────────────────────────────────────────

    def get_all_mail_accounts(self, only_enabled: bool = False) -> list[dict[str, Any]]:
        """Returns all mail accounts (raw) from both 'emails' and 'mail_accounts'."""
        data = self._load()
        accounts = [
            account
            for section in (data.get("emails"), data.get("mail_accounts"))
            if isinstance(section, list)
            for account in section
            if isinstance(account, dict)
        ]
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

    def get_mail_account(self, email: str) -> dict[str, Any] | None:
        """Returns the raw account dict for an email, searching both lists."""
        email_lower = email.strip().lower()
        for acc in self.get_all_mail_accounts():
            if (acc.get("email") or acc.get("username", "")).strip().lower() == email_lower:
                return acc
        return None

    def get_account_by_alias(self, alias_email: str) -> dict[str, Any] | None:
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
    def is_google_account(acc: dict[str, Any]) -> bool:
        """True for Google OAuth2 accounts (use Gmail API)."""
        return bool(acc and acc.get("provider") == "google" and acc.get("auth_type") == "oauth2")

    @staticmethod
    def is_microsoft_account(acc: dict[str, Any]) -> bool:
        """True for Microsoft 365 / Entra ID OAuth2 accounts (use Graph API)."""
        return bool(acc and acc.get("provider") == "microsoft" and acc.get("auth_type") == "oauth2")

    @staticmethod
    def is_imap_account(acc: dict[str, Any]) -> bool:
        """True for any account that should be accessed via IMAP.

        Includes manual, Outlook, and — since the XOAUTH2 migration — Google
        OAuth2 (which used to go through the Gmail API). Google accounts only
        count as IMAP if they have a `refresh_token` (needed to automatically
        renew the access_token).

        """
        if not acc:
            return False
        if IntegrationManager.is_google_account(acc):
            return bool(acc.get("refresh_token"))
        provider = acc.get("provider", "")
        return provider in ("manual", "outlook", "imap") or bool(acc.get("imap_host"))

    @staticmethod
    def is_imap_oauth_account(acc: dict[str, Any]) -> bool:
        """True for accounts that need SASL XOAUTH2 authentication in IMAP.

        Right now only Google OAuth2. Microsoft 365 OAuth2 could also fit
        in here in the future (XOAUTH2 mechanism on port 993 of outlook.office365.com).

        """
        return IntegrationManager.is_google_account(acc) and bool(acc.get("refresh_token"))

    @staticmethod
    def resolve_imap_defaults(acc: dict[str, Any]) -> dict[str, Any]:
        """Returns the account dict with default IMAP/SMTP settings filled in
        for known providers (Outlook, Google) when the caller hasn't set them
        explicitly. Does not persist; only fills in memory."""
        if not acc:
            return acc
        provider = acc.get("provider", "")
        email = acc.get("email", "")

        if provider == "outlook" and not acc.get("imap_host"):
            acc = {
                **acc,
                "imap_host": "outlook.office365.com",
                "imap_port": acc.get("imap_port") or 993,
                "imap_encryption": acc.get("imap_encryption") or "ssl",
                "imap_user": acc.get("imap_user") or email,
                "smtp_host": acc.get("smtp_host") or "smtp.office365.com",
                "smtp_port": acc.get("smtp_port") or 587,
                "smtp_encryption": acc.get("smtp_encryption") or "starttls",
                "smtp_user": acc.get("smtp_user") or email,
            }
        elif IntegrationManager.is_google_account(acc) and not acc.get("imap_host"):
            acc = {
                **acc,
                "imap_host": "imap.gmail.com",
                "imap_port": acc.get("imap_port") or 993,
                "imap_encryption": acc.get("imap_encryption") or "ssl",
                "imap_user": acc.get("imap_user") or email,
                "smtp_host": acc.get("smtp_host") or "smtp.gmail.com",
                "smtp_port": acc.get("smtp_port") or 465,
                "smtp_encryption": acc.get("smtp_encryption") or "ssl",
                "smtp_user": acc.get("smtp_user") or email,
            }
        return acc


integration_manager = IntegrationManager()
