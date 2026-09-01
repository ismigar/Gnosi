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
import logging
from pathlib import Path
from typing import Optional, Dict, List

from cryptography.fernet import Fernet

from backend.config.data_dir import resolve_data_dir
from backend.config.validation_runtime import validation_runtime_enabled


def _get_logger() -> logging.Logger:
    """Lazy logger import to avoid circular dependencies."""
    try:
        from backend.config.logger_config import get_logger

        return get_logger(__name__)
    except ImportError:
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
        return Path("/.dockerenv").exists() or bool(os.environ.get("DOCKER_CONTAINER"))

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
            # timeout=10s because if the Keychain is locked and shows the
            # password dialog, the subprocess hangs indefinitely
            # and blocks the backend thread.
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                # `security add-generic-password` fails with returncode 45 if
                # it already exists; falls back to `-U` (update). If _macos_update also
                # fails, we must return False — previously it always returned True
                # and masked real errors (locked Keychain, etc.).
                return self._macos_update(key, value)
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
            # timeout=10s because if the Keychain is locked and shows the
            # password dialog, the subprocess hangs indefinitely
            # and blocks the backend thread.
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode != 0:
                log.error(
                    f"Keychain update failed for {key_name}: "
                    f"rc={result.returncode} stderr={result.stderr.strip()[:200]}"
                )
                return False
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
            # timeout=10s because if the Keychain is locked and shows the
            # password dialog, the subprocess hangs indefinitely
            # and blocks the backend thread.
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
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
            subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            return True
        except Exception:
            return True

    def _macos_list(self) -> List[str]:
        """List all credentials from macOS Keychain."""
        try:
            cmd = ["security", "dump-trust-settings", "-s", self.service_name]
            # timeout=10s because if the Keychain is locked and shows the
            # password dialog, the subprocess hangs indefinitely
            # and blocks the backend thread.
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
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

    # ── Portable system keyring (Windows / Linux) ─────────────────────

    def _portable_save(self, key: str, value: str) -> bool:
        try:
            import keyring

            keyring.set_password(self.service_name, self._get_key_name(key), value)
            return True
        except Exception as exc:
            log.info("System credential store unavailable; using encrypted fallback: %s", exc)
            return False

    def _portable_get(self, key: str) -> Optional[str]:
        try:
            import keyring

            return keyring.get_password(self.service_name, self._get_key_name(key))
        except Exception:
            return None

    def _portable_delete(self, key: str) -> bool:
        try:
            import keyring

            keyring.delete_password(self.service_name, self._get_key_name(key))
            return True
        except Exception:
            return False

    # ── File-based Fallback ────────────────────────────────────────────

    def _get_fallback_path(self) -> Path:
        """Return the encrypted fallback inside the canonical data root."""
        secrets_dir = resolve_data_dir(create=True) / "secrets"
        secrets_dir.mkdir(parents=True, exist_ok=True)
        try:
            secrets_dir.chmod(0o700)
        except OSError:
            pass
        return secrets_dir / "credentials.enc"

    def _get_fallback_key_path(self) -> Path:
        return self._get_fallback_path().with_name("credentials.key")

    def _legacy_fallback_path(self) -> Path:
        return Path.home() / ".gnosi" / "secrets" / "credentials.enc"

    @staticmethod
    def _protect_file(path: Path) -> None:
        try:
            path.chmod(0o600)
        except OSError:
            pass

    def _fallback_cipher(self) -> Fernet:
        storage_path = self._get_fallback_path()
        key_path = self._get_fallback_key_path()
        if not key_path.exists():
            if storage_path.exists():
                raise RuntimeError(
                    f"Encrypted credential key is missing for {storage_path}; refusing to overwrite it"
                )
            from backend.utils.safe_io import safe_write_bytes

            safe_write_bytes(key_path, Fernet.generate_key())
            self._protect_file(key_path)
        key = key_path.read_bytes().strip()
        self._protect_file(key_path)
        return Fernet(key)

    def _read_legacy_data(self) -> Dict[str, str]:
        """Read the old fallback once so its values can be migrated safely."""
        legacy_path = self._legacy_fallback_path()
        if not legacy_path.exists() or legacy_path == self._get_fallback_path():
            return {}
        content = legacy_path.read_bytes()
        master_key = os.environ.get("GNOSI_MASTER_KEY", "").encode()
        if master_key:
            import hashlib
            from cryptography.fernet import Fernet

            cipher = Fernet(base64.urlsafe_b64encode(hashlib.sha256(master_key).digest()))
            try:
                decoded = json.loads(cipher.decrypt(content))
                if isinstance(decoded, dict):
                    return {str(key): str(value) for key, value in decoded.items()}
            except Exception:
                pass
        try:
            data = json.loads(content)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _read_file_data(self) -> Dict[str, str]:
        storage_path = self._get_fallback_path()
        if not storage_path.exists():
            return self._read_legacy_data()
        from cryptography.fernet import InvalidToken

        try:
            data = json.loads(self._fallback_cipher().decrypt(storage_path.read_bytes()))
        except InvalidToken as exc:
            raise RuntimeError(
                f"Encrypted credential file cannot be decrypted: {storage_path}"
            ) from exc
        if not isinstance(data, dict):
            raise RuntimeError(f"Encrypted credential file has an invalid payload: {storage_path}")
        return {str(key): str(value) for key, value in data.items()}

    def _write_file_data(self, data: Dict[str, str]) -> None:
        from backend.utils.safe_io import safe_write_bytes

        storage_path = self._get_fallback_path()
        encrypted = self._fallback_cipher().encrypt(json.dumps(data).encode("utf-8"))
        safe_write_bytes(storage_path, encrypted)
        self._protect_file(storage_path)

    def _file_save(self, key: str, value: str) -> bool:
        """Save a credential to the mandatory encrypted fallback."""
        try:
            data = self._read_file_data()
            data[key] = value
            self._write_file_data(data)
            return True
        except Exception as e:
            log.error(f"Failed to save to file: {e}")
            return False

    def _file_get(self, key: str) -> Optional[str]:
        """Get credential from encrypted file (fallback)."""
        try:
            return self._read_file_data().get(key)
        except Exception as exc:
            log.error("Failed to read encrypted credential fallback: %s", exc)
            return None

    def _file_delete(self, key: str) -> bool:
        """Delete credential from file."""
        try:
            storage_path = self._get_fallback_path()
            legacy_path = self._legacy_fallback_path()
            if not storage_path.exists() and not legacy_path.exists():
                return True
            data = self._read_file_data()
            data.pop(key, None)
            self._write_file_data(data)
            return True
        except Exception as exc:
            log.error("Failed to delete encrypted fallback credential: %s", exc)
            return False

    # ── Public API ────────────────────────────────────────────────────

    def save_credential(self, key: str, value: str) -> bool:
        """Save a credential to the secure storage."""
        if validation_runtime_enabled():
            return False
        if self._is_docker:
            existing = self._docker_get(key)
            # Only short-circuit when the value is UNCHANGED. Returning True for
            # any existing secret meant an update was silently dropped (the UI
            # reported "saved" while the old value stood).
            if existing is not None and existing == value:
                return True
            # Docker secrets are read-only at runtime; persist changes/new values
            # via the writable fallback.
            if self._docker_save(key, value):
                return True
            return self._file_save(key, value)

        stored = (
            self._macos_save(key, value)
            if self.system == "Darwin"
            else self._portable_save(key, value)
        )
        return stored or self._file_save(key, value)

    def get_credential(self, key: str) -> Optional[str]:
        """Get a credential from the secure storage."""
        if validation_runtime_enabled():
            return None
        if self._is_docker:
            from_docker_secret = self._docker_get(key)
            if from_docker_secret is not None:
                return from_docker_secret
            return self._file_get(key)

        if self.system == "Darwin":
            value = self._macos_get(key)
            if value:
                return value
        else:
            value = self._portable_get(key)
            if value:
                return value

        return self._file_get(key)

    def delete_credential(self, key: str) -> bool:
        """Delete a credential from the secure storage."""
        if validation_runtime_enabled():
            return False
        if self._is_docker:
            return self._file_delete(key)

        if self.system == "Darwin":
            self._macos_delete(key)
        else:
            self._portable_delete(key)

        return self._file_delete(key)

    def list_credentials(self) -> List[str]:
        """List all stored credential keys (values not returned)."""
        if validation_runtime_enabled():
            return []
        keys = []

        if self.system == "Darwin" and not self._is_docker:
            stored = self._macos_list()
            for item in stored:
                if "acct" in item:
                    parts = item.split("=")
                    if len(parts) > 1:
                        keys.append(parts[1].strip('"').replace(f"{SERVICE_PREFIX}_", ""))

        try:
            for key in self._read_file_data():
                if key not in keys:
                    keys.append(key)
        except Exception:
            pass

        return keys

    def has_credential(self, key: str) -> bool:
        """Check if a credential exists."""
        return self.get_credential(key) is not None


_keychain_instance: KeychainManager | None = None


def get_keychain() -> KeychainManager:
    """Get singleton keychain manager instance."""
    global _keychain_instance
    if _keychain_instance is None:
        _keychain_instance = KeychainManager()
    return _keychain_instance
