# backend/security/keychain_manager.py
"""
Keychain Manager - Secure credentials storage using macOS Keychain.

For macOS: Uses the native Keychain via `security` CLI.
For Docker/Linux: Falls back to encrypted file storage.

Credentials are stored with the prefix "gnosi_" to avoid collisions.
"""

import os
import sys
import subprocess
import platform
import json
import base64
from pathlib import Path
from typing import Optional, Dict, List


def _get_logger():
    """Lazy logger import to avoid circular dependencies."""
    try:
        from backend.config.logger_config import get_logger

        return get_logger(__name__)
    except ImportError:
        import logging

        return logging.getLogger(__name__)


log = _get_logger()

SERVICE_PREFIX = "gnosi"
DOCKER_SECRETS_DIR = Path("/run/secrets")


class KeychainManager:
    """Manages credentials storage using system keychain when available."""

    def __init__(self, service_name: str = "gnosi-app"):
        self.service_name = service_name
        self.system = platform.system()
        self._is_docker = self._check_docker()

    def _check_docker(self) -> bool:
        """Check if running inside Docker."""
        return Path("/.dockerenv").exists() or os.environ.get("DOCKER_CONTAINER")

    def _get_key_name(self, key: str) -> str:
        """Generate keychain key name with prefix."""
        return f"{SERVICE_PREFIX}_{key}"

    # ── macOS Keychain Methods ──────────────────────────────────────────

    def _macos_save(self, key: str, value: str) -> bool:
        """Save credential to macOS Keychain."""
        key_name = self._get_key_name(key)
        try:
            cmd = [
                "security",
                "add-generic-password",
                "-s",
                self.service_name,
                "-a",
                key_name,
                "-w",
                value,
                "-D",
                "Gnosi Credential",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                self._macos_update(key, value)
            return True
        except Exception as e:
            log.error(f"Failed to save to Keychain: {e}")
            return False

    def _macos_update(self, key: str, value: str) -> bool:
        """Update existing Keychain credential."""
        key_name = self._get_key_name(key)
        try:
            cmd = [
                "security",
                "add-generic-password",
                "-s",
                self.service_name,
                "-a",
                key_name,
                "-w",
                value,
                "-D",
                "Gnosi Credential",
                "-U",
            ]
            subprocess.run(cmd, capture_output=True, text=True)
            return True
        except Exception as e:
            log.error(f"Failed to update Keychain: {e}")
            return False

    def _macos_get(self, key: str) -> Optional[str]:
        """Get credential from macOS Keychain."""
        key_name = self._get_key_name(key)
        try:
            cmd = [
                "security",
                "find-generic-password",
                "-s",
                self.service_name,
                "-a",
                key_name,
                "-w",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception as e:
            log.warning(f"Failed to get from Keychain: {e}")
        return None

    def _macos_delete(self, key: str) -> bool:
        """Delete credential from macOS Keychain."""
        key_name = self._get_key_name(key)
        try:
            cmd = [
                "security",
                "delete-generic-password",
                "-s",
                self.service_name,
                "-a",
                key_name,
            ]
            subprocess.run(cmd, capture_output=True, text=True)
            return True
        except Exception:
            return True

    def _macos_list(self) -> List[str]:
        """List all credentials from macOS Keychain."""
        try:
            cmd = ["security", "dump-trust-settings", "-s", self.service_name]
            result = subprocess.run(cmd, capture_output=True, text=True)
            lines = result.stdout.split("\n")
            return [line.strip() for line in lines if "acct" in line.lower()]
        except Exception:
            return []

    # ── Docker Secrets Fallback ────────────────────────────────────────

    def _docker_get(self, key: str) -> Optional[str]:
        """Get credential from Docker secrets."""
        secret_path = DOCKER_SECRETS_DIR / f"{SERVICE_PREFIX}_{key}"
        if secret_path.exists():
            return secret_path.read_text().strip()
        return None

    def _docker_save(self, key: str, value: str) -> bool:
        """Docker secrets are read-only at runtime, cannot save."""
        log.warning("Cannot save to Docker secrets at runtime")
        return False

    # ── File-based Fallback ────────────────────────────────────────────

    def _get_fallback_path(self) -> Path:
        """Get path for file-based fallback storage."""
        secrets_dir = Path.home() / ".gnosi" / "secrets"
        secrets_dir.mkdir(parents=True, exist_ok=True)
        return secrets_dir / "credentials.enc"

    def _file_save(self, key: str, value: str) -> bool:
        """Save credential to encrypted file (fallback)."""
        try:
            import hashlib
            from cryptography.fernet import Fernet

            storage_path = self._get_fallback_path()
            data = {}

            if storage_path.exists():
                with open(storage_path, "rb") as f:
                    encrypted = f.read()
                master_key = os.environ.get("GNOSI_MASTER_KEY", "").encode()
                if master_key:
                    cipher = Fernet(
                        base64.urlsafe_b64encode(hashlib.sha256(master_key).digest())
                    )
                    try:
                        data = json.loads(cipher.decrypt(encrypted))
                    except Exception:
                        pass

            data[key] = value

            master_key = os.environ.get("GNOSI_MASTER_KEY", "").encode()
            if master_key:
                cipher = Fernet(
                    base64.urlsafe_b64encode(hashlib.sha256(master_key).digest())
                )
                with open(storage_path, "wb") as f:
                    f.write(cipher.encrypt(json.dumps(data).encode()))
            else:
                with open(storage_path, "w") as f:
                    json.dump(data, f)

            return True
        except Exception as e:
            log.error(f"Failed to save to file: {e}")
            return False

    def _file_get(self, key: str) -> Optional[str]:
        """Get credential from encrypted file (fallback)."""
        try:
            storage_path = self._get_fallback_path()
            if not storage_path.exists():
                return None

            master_key = os.environ.get("GNOSI_MASTER_KEY", "").encode()

            with open(storage_path, "rb") as f:
                content = f.read()

            if master_key:
                import hashlib
                from cryptography.fernet import Fernet

                cipher = Fernet(
                    base64.urlsafe_b64encode(hashlib.sha256(master_key).digest())
                )
                data = json.loads(cipher.decrypt(content))
            else:
                data = json.loads(content)

            return data.get(key)
        except Exception:
            return None

    def _file_delete(self, key: str) -> bool:
        """Delete credential from file."""
        try:
            storage_path = self._get_fallback_path()
            if not storage_path.exists():
                return True

            import hashlib
            from cryptography.fernet import Fernet

            master_key = os.environ.get("GNOSI_MASTER_KEY", "").encode()

            with open(storage_path, "rb") as f:
                content = f.read()

            if master_key:
                cipher = Fernet(
                    base64.urlsafe_b64encode(hashlib.sha256(master_key).digest())
                )
                data = json.loads(cipher.decrypt(content))
            else:
                data = json.loads(content)

            data.pop(key, None)

            if master_key:
                cipher = Fernet(
                    base64.urlsafe_b64encode(hashlib.sha256(master_key).digest())
                )
                with open(storage_path, "wb") as f:
                    f.write(cipher.encrypt(json.dumps(data).encode()))
            else:
                with open(storage_path, "w") as f:
                    json.dump(data, f)

            return True
        except Exception:
            return True

    # ── Public API ────────────────────────────────────────────────────

    def save_credential(self, key: str, value: str) -> bool:
        """Save a credential to the secure storage."""
        if self._is_docker:
            secret = self._docker_get(key)
            if secret is not None:
                return True
            # Docker secrets are read-only at runtime; fallback to local encrypted file.
            if self._docker_save(key, value):
                return True
            return self._file_save(key, value)

        if self.system == "Darwin":
            return self._macos_save(key, value)

        return self._file_save(key, value)

    def get_credential(self, key: str) -> Optional[str]:
        """Get a credential from the secure storage."""
        if self._is_docker:
            from_docker_secret = self._docker_get(key)
            if from_docker_secret is not None:
                return from_docker_secret
            return self._file_get(key)

        if self.system == "Darwin":
            value = self._macos_get(key)
            if value:
                return value

        return self._file_get(key)

    def delete_credential(self, key: str) -> bool:
        """Delete a credential from the secure storage."""
        if self._is_docker:
            return self._file_delete(key)

        if self.system == "Darwin":
            self._macos_delete(key)

        return self._file_delete(key)

    def list_credentials(self) -> List[str]:
        """List all stored credential keys (values not returned)."""
        keys = []

        if self.system == "Darwin" and not self._is_docker:
            stored = self._macos_list()
            for item in stored:
                if "acct" in item:
                    parts = item.split("=")
                    if len(parts) > 1:
                        keys.append(
                            parts[1].strip('"').replace(f"{SERVICE_PREFIX}_", "")
                        )

        try:
            storage_path = self._get_fallback_path()
            if storage_path.exists():
                import hashlib
                from cryptography.fernet import Fernet

                master_key = os.environ.get("GNOSI_MASTER_KEY", "").encode()

                with open(storage_path, "rb") as f:
                    content = f.read()

                if master_key:
                    cipher = Fernet(
                        base64.urlsafe_b64encode(hashlib.sha256(master_key).digest())
                    )
                    data = json.loads(cipher.decrypt(content))
                else:
                    data = json.loads(content)

                for k in data.keys():
                    if k not in keys:
                        keys.append(k)
        except Exception:
            pass

        return keys

    def has_credential(self, key: str) -> bool:
        """Check if a credential exists."""
        return self.get_credential(key) is not None


def get_keychain() -> KeychainManager:
    """Get singleton keychain manager instance."""
    if not hasattr(get_keychain, "_instance"):
        get_keychain._instance = KeychainManager()
    return get_keychain._instance
