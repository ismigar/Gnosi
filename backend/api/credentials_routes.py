# backend/api/credentials_routes.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.security.keychain_manager import get_keychain
from backend.config.env_config import configured_shared_env_path, reload_keychain
from backend.services.workspace_service import require_role

# Auth gate: these endpoints manage the Keychain (HuggingFace, OpenRouter,
# Telegram, n8n, OAuth secrets, etc.). In personal mode the user is auto-owner
# and isn't blocked; in organization mode only admins can touch credentials.
router = APIRouter(
    prefix="/credentials",
    tags=["Credentials"],
    dependencies=[Depends(require_role("admin"))],
)

CREDENTIAL_INFO = {
    "huggingface_api_key": {
        "name": "Hugging Face",
        "description": "API key for Hugging Face",
    },
    "groq_api_key": {"name": "Groq", "description": "API key for Groq LLM"},
    "openrouter_api_key": {
        "name": "OpenRouter",
        "description": "API key for OpenRouter",
    },
    "telegram_bot_token": {"name": "Telegram", "description": "Bot token for Telegram"},
    "google_oauth_client_id": {
        "name": "Google OAuth",
        "description": "OAuth Client ID",
    },
    "google_oauth_client_secret": {
        "name": "Google OAuth Secret",
        "description": "OAuth Client Secret",
    },
    "ssh_password": {"name": "SSH", "description": "Password for SSH connections"},
    "ssh_suweb_password": {
        "name": "SSH SUWEB",
        "description": "SUWEB password for Drupal",
    },
    "drupal_root_password": {
        "name": "Drupal",
        "description": "Root password for Drupal",
    },
    "newsletters_password": {
        "name": "Newsletters",
        "description": "Password for newsletters mailbox",
    },
    "imap_password": {"name": "IMAP", "description": "Password for IMAP mailbox"},
    "mastodon_bearer": {"name": "Mastodon", "description": "Bearer token for Mastodon"},
    "bluesky_app_password": {
        "name": "Bluesky",
        "description": "App password for Bluesky",
    },
    "deepl_api_key": {
        "name": "DeepL",
        "description": "API key for DeepL translation (used by translate_row skill)",
    },
    "core_api_key": {"name": "CORE", "description": "API key for CORE academic search"},
    "openalex_api_key": {"name": "OpenAlex", "description": "API key for OpenAlex academic search"},
    "semantic_scholar_api_key": {"name": "Semantic Scholar", "description": "API key for Semantic Scholar"},
    "springer_nature_api_key": {"name": "Springer Nature", "description": "API key for Springer Nature"},
    "scopus_api_key": {"name": "Scopus", "description": "API key for Scopus"},
    "web_of_science_api_key": {"name": "Web of Science", "description": "API key for Web of Science"},
    "dimensions_api_key": {"name": "Dimensions", "description": "API key for Dimensions"},
}

CREDENTIAL_KEYS = list(CREDENTIAL_INFO.keys())


class CredentialSet(BaseModel):
    key: str
    value: str


class CredentialStatus(BaseModel):
    key: str
    name: str
    description: str
    has_value: bool


@router.get("/", response_model=List[CredentialStatus])
async def list_credentials():
    """List all credentials with their status (without exposing values)."""
    keychain = get_keychain()
    result = []

    for key in CREDENTIAL_KEYS:
        has_value = keychain.has_credential(key)
        info = CREDENTIAL_INFO.get(key, {"name": key, "description": ""})
        result.append(
            CredentialStatus(
                key=key,
                name=info["name"],
                description=info["description"],
                has_value=has_value,
            )
        )

    return result


@router.get("/{credential_key}")
async def get_credential_status(credential_key: str):
    """Check if a specific credential exists."""
    if credential_key not in CREDENTIAL_KEYS:
        raise HTTPException(status_code=404, detail="Credential not found")

    keychain = get_keychain()
    has_value = keychain.has_credential(credential_key)
    info = CREDENTIAL_INFO.get(
        credential_key, {"name": credential_key, "description": ""}
    )

    return {
        "key": credential_key,
        "name": info["name"],
        "description": info["description"],
        "has_value": has_value,
    }


@router.post("/")
async def set_credential(credential: CredentialSet):
    """Set a credential value."""
    if credential.key not in CREDENTIAL_KEYS:
        raise HTTPException(status_code=404, detail="Credential not found")

    keychain = get_keychain()
    success = keychain.save_credential(credential.key, credential.value)

    if success:
        reload_keychain()
        return {
            "status": "success",
            "key": credential.key,
            "message": "Credential saved",
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to save credential")


@router.delete("/{credential_key}")
async def delete_credential(credential_key: str):
    """Delete a credential."""
    if credential_key not in CREDENTIAL_KEYS:
        raise HTTPException(status_code=404, detail="Credential not found")

    keychain = get_keychain()
    success = keychain.delete_credential(credential_key)

    if success:
        reload_keychain()
        return {
            "status": "success",
            "key": credential_key,
            "message": "Credential deleted",
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to delete credential")


@router.post("/migrate")
async def migrate_from_env():
    """Import credentials from the explicitly configured shared env file."""
    env_path = configured_shared_env_path()

    if env_path is None or not env_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="GNOSI_SHARED_ENV_FILE is not configured or does not exist",
        )

    keychain = get_keychain()
    migrated = []
    failed = []

    env_vars = {}
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                env_vars[key.strip()] = value.strip()

    # Case-insensitive mapping: env vars are UPPERCASE (NOTION_TOKEN), the
    # CREDENTIAL_KEYS are lowercase (notion_token). Without this normalization,
    # the migration would silently move nothing.
    cred_keys_lower = {k.lower(): k for k in CREDENTIAL_KEYS}
    for env_key, value in env_vars.items():
        canonical = cred_keys_lower.get(env_key.lower())
        if canonical and value:
            success = keychain.save_credential(canonical, value)
            if success:
                migrated.append(canonical)
            else:
                failed.append(canonical)

    return {
        "status": "success",
        "migrated": migrated,
        "failed": failed,
        "total": len(migrated),
        "source_modified": False,
    }
