"""Environment loading with explicit Gnosi 3.x precedence and boundaries."""

from __future__ import annotations

import os
import re
import sys
import warnings
from pathlib import Path
from typing import Any

from dotenv import dotenv_values

from backend.config.data_dir import is_docker_runtime
from backend.utils.safe_io import safe_write_text


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOCAL_ENV = PROJECT_ROOT / ".env"
ENV_LOCATIONS = [LOCAL_ENV]
_ENV_ASSIGNMENT_RE = re.compile(r"^\s*([A-Z_][A-Z0-9_]*)\s*=")
_SENSITIVE_ENV_MARKERS = (
    "TOKEN",
    "KEY",
    "SECRET",
    "PASSWORD",
    "PASS",
    "CREDENTIAL",
    "PRIVATE",
)

KEYCHAIN_ENV_MAPPING = {
    "HF_API_KEY": "huggingface_api_key",
    "GROQ_API_KEY": "groq_api_key",
    "OPENAI_API_KEY": "openai_api_key",
    "ANTHROPIC_API_KEY": "anthropic_api_key",
    "OPENROUTER_API_KEY": "openrouter_api_key",
    "GOOGLE_API_KEY": "google_api_key",
    "TELEGRAM_BOT_TOKEN": "telegram_bot_token",
    "GOOGLE_OAUTH_CLIENT_ID": "google_oauth_client_id",
    "GOOGLE_OAUTH_CLIENT_SECRET": "google_oauth_client_secret",
    "MICROSOFT_OAUTH_CLIENT_ID": "microsoft_oauth_client_id",
    "MICROSOFT_OAUTH_CLIENT_SECRET": "microsoft_oauth_client_secret",
    "SSH_PASSWORD": "ssh_password",
    "SSH_SUWEB_PASSWORD": "ssh_suweb_password",
    "DRUPAL_ROOT_PASSWORD": "drupal_root_password",
    "NEWSLETTERS_PASSWORD": "newsletters_password",
    "IMAP_PASS": "imap_password",
    "TEMENOS_MASTODON_BEARER": "mastodon_bearer",
    "TEMENOS_BLUESKY_APP_PASSWORD": "bluesky_app_password",
    "CORE_API_KEY": "core_api_key",
    "OPENALEX_API_KEY": "openalex_api_key",
    "SEMANTIC_SCHOLAR_API_KEY": "semantic_scholar_api_key",
    "SPRINGER_NATURE_API_KEY": "springer_nature_api_key",
    "SCOPUS_API_KEY": "scopus_api_key",
    "WEB_OF_SCIENCE_API_KEY": "web_of_science_api_key",
    "DIMENSIONS_API_KEY": "dimensions_api_key",
}

_loaded = False
_keychain_loaded = False
_loaded_file_values: dict[str, str] = {}
_loaded_keychain_values: dict[str, str] = {}


def _is_docker() -> bool:
    return is_docker_runtime()


def is_sensitive_env_key(name: str) -> bool:
    """Return whether an environment key represents credential material."""
    upper = str(name or "").strip().upper()
    return any(marker in upper for marker in _SENSITIVE_ENV_MARKERS)


def keychain_key_for_env(name: str) -> str | None:
    """Map an environment credential to its stable secure-store key."""
    upper = str(name or "").strip().upper()
    if not upper or not is_sensitive_env_key(upper):
        return None
    return KEYCHAIN_ENV_MAPPING.get(upper, f"env_{upper.lower()}")


def configured_shared_env_path(environ: dict[str, str] | None = None) -> Path | None:
    """Return the explicitly configured shared env file, never an inferred one."""
    env = os.environ if environ is None else environ
    raw = str(env.get("GNOSI_SHARED_ENV_FILE") or "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return Path(os.path.abspath(path))


def remove_env_keys(env_keys, env_paths=None) -> list[str]:
    """Remove variables from Gnosi's local env and current process only.

    The shared environment file is an operator-owned, read-only input. Even an
    explicitly supplied path is skipped when it resolves to the configured
    shared file.
    """
    keys = {str(key).strip().upper() for key in (env_keys or []) if str(key).strip()}
    if not keys:
        return []

    removed: set[str] = set()
    paths = ENV_LOCATIONS if env_paths is None else env_paths
    shared_path = configured_shared_env_path()
    seen_paths: set[Path] = set()
    for candidate in paths:
        path = Path(candidate)
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path.absolute()
        if resolved in seen_paths or (shared_path and resolved == shared_path.resolve()):
            continue
        seen_paths.add(resolved)
        if not path.exists():
            continue

        original = path.read_text(encoding="utf-8")
        kept_lines = []
        changed = False
        for line in original.splitlines(keepends=True):
            match = _ENV_ASSIGNMENT_RE.match(line)
            if match and match.group(1).upper() in keys:
                removed.add(match.group(1).upper())
                changed = True
                continue
            kept_lines.append(line)
        if changed:
            safe_write_text(path, "".join(kept_lines))

    for key in keys:
        if key in os.environ:
            removed.add(key)
            os.environ.pop(key, None)
        _loaded_file_values.pop(key, None)
        _loaded_keychain_values.pop(key, None)
    return sorted(removed)


def is_frozen_runtime() -> bool:
    """Return whether the backend is running from a frozen desktop bundle."""
    return bool(getattr(sys, "frozen", False))


def default_host_helper_url(path: str) -> str:
    """Return the native or container URL for the host helper."""
    host = "host.docker.internal" if _is_docker() else "127.0.0.1"
    return f"http://{host}:5099{path}"


def default_ollama_base_url() -> str:
    """Return the native or container URL for host-side Ollama."""
    override = os.environ.get("OLLAMA_BASE_URL")
    if override:
        return override.rstrip("/")
    host = "host.docker.internal" if _is_docker() else "127.0.0.1"
    return f"http://{host}:11434"


def default_thumb_daemon_url() -> str:
    """Return the native or container URL for the QuickLook daemon."""
    override = os.environ.get("THUMB_DAEMON_URL")
    if override:
        return override
    host = "host.docker.internal" if _is_docker() else "127.0.0.1"
    return f"http://{host}:5009/thumb"


def _clear_values_loaded_by_gnosi() -> None:
    for loaded_values in (_loaded_file_values, _loaded_keychain_values):
        for key, value in list(loaded_values.items()):
            if os.environ.get(key) == value:
                os.environ.pop(key, None)
        loaded_values.clear()


def _read_env_file(path: Path | None) -> dict[str, str]:
    if path is None or not path.is_file():
        return {}
    return {
        str(key): str(value)
        for key, value in dotenv_values(path).items()
        if value is not None
    }


def _load_keychain() -> None:
    """Fill absent credential variables from secure storage."""
    global _keychain_loaded
    if _keychain_loaded or _is_docker():
        _keychain_loaded = True
        return

    try:
        from backend.security.keychain_manager import get_keychain

        keychain = get_keychain()
        for env_name, keychain_key in KEYCHAIN_ENV_MAPPING.items():
            if os.environ.get(env_name):
                continue
            value = keychain.get_credential(keychain_key)
            if value:
                os.environ[env_name] = value
                _loaded_keychain_values[env_name] = value
    except Exception as exc:
        warnings.warn(f"Gnosi secure-store loading was unavailable: {exc}", RuntimeWarning)
    finally:
        _keychain_loaded = True


def load_env(force_reload: bool = False) -> None:
    """Load explicit shared and local files without overriding process values.

    Effective precedence is process environment, repository-local `.env`, then
    the explicitly configured shared file.
    """
    global _loaded, _keychain_loaded
    if _loaded and not force_reload:
        return
    if force_reload:
        _clear_values_loaded_by_gnosi()
        _keychain_loaded = False

    process_values = dict(os.environ)
    merged = _read_env_file(configured_shared_env_path(process_values))
    merged.update(_read_env_file(LOCAL_ENV))
    for key, value in merged.items():
        if key not in process_values:
            os.environ[key] = value
            _loaded_file_values[key] = value

    _load_keychain()
    _loaded = True


def get_env(name: str, default: Any = None, required: bool = False):
    load_env()
    value = os.environ.get(name)
    if not value:
        secure_key = keychain_key_for_env(name)
        if secure_key:
            try:
                from backend.security.keychain_manager import get_keychain

                value = get_keychain().get_credential(secure_key)
            except Exception:
                value = None
    if value is None:
        value = default
    if required and (value is None or value == ""):
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


def require_env(*names: str) -> None:
    """Raise a clear error when required environment variables are absent."""
    missing = [name for name in names if not get_env(name)]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")


def reload_keychain() -> None:
    """Force environment and secure-store values to reload."""
    load_env(force_reload=True)
