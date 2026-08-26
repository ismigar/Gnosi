# backend/config/env_config.py
import os
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

from backend.utils.safe_io import safe_write_text

try:
    PROJECTES_ROOT = (
        Path(__file__).resolve().parents[5]
    )  # config -> backend -> gnosi -> apps -> monorepo -> Projectes
except IndexError:
    PROJECTES_ROOT = Path(__file__).resolve().parent.parent.parent

SHARED_ENV = PROJECTES_ROOT / ".env_shared"

ENV_LOCATIONS = [
    SHARED_ENV,  # Shared ones first
    Path.cwd() / ".env",
    Path(__file__).resolve().parents[1] / ".env",
]
_ENV_ASSIGNMENT_RE = re.compile(r"^\s*([A-Z_][A-Z0-9_]*)\s*=")

_loaded = False
_keychain_loaded = False


def remove_env_keys(env_keys, env_paths=None) -> list[str]:
    """Remove secret variables from managed env files and the live process.

    Values injected by an external service manager cannot be edited from the
    backend, so provider tombstones remain the final guard for those sources.
    """
    keys = {
        str(key).strip().upper()
        for key in (env_keys or [])
        if str(key).strip()
    }
    if not keys:
        return []

    removed = set()
    paths = ENV_LOCATIONS if env_paths is None else env_paths
    seen_paths = set()
    for candidate in paths:
        path = Path(candidate)
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        if resolved in seen_paths:
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
    return sorted(removed)


def _is_docker() -> bool:
    return Path("/.dockerenv").exists() or bool(os.environ.get("DOCKER_CONTAINER"))


def is_frozen_runtime() -> bool:
    """Return whether the backend is running from a frozen desktop bundle."""
    return bool(getattr(sys, "frozen", False))


def default_host_helper_url(path: str) -> str:
    """Default URL for the host helper services (host_open_helper, port 5099).

    The helper always runs on the HOST: a backend inside Docker reaches it via
    `host.docker.internal`, a native backend on plain loopback. Leaving the
    Docker hostname as the unconditional default made native installs silently
    lose the helper (Spotlight search degraded to os.walk, moving attachments
    to the macOS Trash returned 502) — same failure family as the warmup-mode
    autodetection in files_provider/onedrive.py (PR #838). The per-endpoint
    `GNOSI_HOST_*_HELPER_URL` env vars still override this default.
    """
    host = "host.docker.internal" if _is_docker() else "127.0.0.1"
    return f"http://{host}:5099{path}"


def default_ollama_base_url() -> str:
    """Default base URL for a host-side Ollama daemon (port 11434).

    Same autodetection rationale as `default_host_helper_url`: Ollama runs on the
    HOST, so a Docker backend reaches it via `host.docker.internal` while a native
    backend must use loopback. `OLLAMA_BASE_URL` overrides the default.
    """
    override = os.environ.get("OLLAMA_BASE_URL")
    if override:
        return override.rstrip("/")
    host = "host.docker.internal" if _is_docker() else "127.0.0.1"
    return f"http://{host}:11434"


def default_thumb_daemon_url() -> str:
    """Default URL for the QuickLook thumbnail daemon (port 5009).

    Same autodetection rationale as `default_host_helper_url`: the daemon runs on
    the HOST, so a Docker backend reaches it via `host.docker.internal` while a
    native backend must use loopback. Hardcoding the Docker hostname made
    thumbnails for videos/PDFs/audio silently break on native installs (the
    default runtime). `THUMB_DAEMON_URL` overrides this default.
    """
    override = os.environ.get("THUMB_DAEMON_URL")
    if override:
        return override
    host = "host.docker.internal" if _is_docker() else "127.0.0.1"
    return f"http://{host}:5009/thumb"


def _load_keychain():
    """Load credentials from Keychain if available. Skipped in Docker (env vars come from env_file)."""
    global _keychain_loaded
    if _keychain_loaded:
        return
    if _is_docker():
        _keychain_loaded = True
        return

    try:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from backend.security.keychain_manager import get_keychain

        keychain = get_keychain()

        key_mapping = {
            "HF_API_KEY": "huggingface_api_key",
            "GROQ_API_KEY": "groq_api_key",
            "OPENROUTER_API_KEY": "openrouter_api_key",
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

        # Notion references removed for Standalone Sovereignty


        for env_name, keychain_key in key_mapping.items():
            if env_name not in os.environ or not os.environ.get(env_name):
                value = keychain.get_credential(keychain_key)
                if value:
                    os.environ[env_name] = value

        _keychain_loaded = True
    except Exception:
        pass


def load_env(force_reload: bool = False):
    global _loaded
    if _loaded and not force_reload:
        return

    _load_keychain()

    if SHARED_ENV.exists():
        load_dotenv(SHARED_ENV)

    for p in ENV_LOCATIONS[1:]:
        if p.exists():
            load_dotenv(p, override=True)
            break

    _loaded = True


def get_env(name: str, default=None, required=False):
    load_env()
    value = os.environ.get(name, default)
    if required and (value is None or value == ""):
        raise RuntimeError(f"❌ Missing environment variable: {name}")
    return value


def require_env(*names: str):
    """
    Checks that all indicated environment variables exist.
    Raises a clear exception if any are missing.
    """
    load_env()

    missing = []
    for name in names:
        value = os.environ.get(name)
        if value is None or value == "":
            missing.append(name)

    if missing:
        raise RuntimeError(
            f"❌ Missing environment variables configuration: {', '.join(missing)}"
        )


def reload_keychain():
    """Force reload credentials from Keychain."""
    global _keychain_loaded
    _keychain_loaded = False
    _load_keychain()
