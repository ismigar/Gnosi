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
    SHARED_ENV,  # Primer les compartides
    Path.cwd() / ".env",
    Path(__file__).resolve().parents[1] / ".env",
]

_loaded = False
_keychain_loaded = False


def _load_keychain():
    """Load credentials from Keychain if available."""
    global _keychain_loaded
    if _keychain_loaded:
        return

    try:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from backend.security.keychain_manager import get_keychain

        keychain = get_keychain()

        key_mapping = {
            "NOTION_TOKEN": "notion_token",
            "HF_API_KEY": "huggingface_api_key",
            "GROQ_API_KEY": "groq_api_key",
            "OPENROUTER_API_KEY": "openrouter_api_key",
            "TELEGRAM_BOT_TOKEN": "telegram_bot_token",
            "N8N_API_KEY": "n8n_api_key",
            "N8N_PASSWORD": "n8n_password",
            "GOOGLE_OAUTH_CLIENT_ID": "google_oauth_client_id",
            "GOOGLE_OAUTH_CLIENT_SECRET": "google_oauth_client_secret",
            "SSH_PASSWORD": "ssh_password",
            "SSH_SUWEB_PASSWORD": "ssh_suweb_password",
            "DRUPAL_ROOT_PASSWORD": "drupal_root_password",
            "NEWSLETTERS_PASSWORD": "newsletters_password",
            "IMAP_PASS": "imap_password",
            "TEMENOS_MASTODON_BEARER": "mastodon_bearer",
            "TEMENOS_BLUESKY_APP_PASSWORD": "bluesky_app_password",
        }

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
