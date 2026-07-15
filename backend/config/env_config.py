# backend/config/env_config.py
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

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

_loaded = False
_keychain_loaded = False


def _is_docker() -> bool:
    return Path("/.dockerenv").exists() or bool(os.environ.get("DOCKER_CONTAINER"))


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
