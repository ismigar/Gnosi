from fastapi import APIRouter, Depends, HTTPException, Request
import logging
import os
import re
from pathlib import Path
from typing import Any

from backend.config.env_config import (
    LOCAL_ENV,
    is_sensitive_env_key,
    keychain_key_for_env,
    load_env,
)
from backend.security.keychain_manager import get_keychain
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text
from backend.services.workspace_service import require_role

# Auth gate: in personal mode the user is auto-promoted to "owner" so
# require_role("admin") doesn't block. In organization mode it protects the
# env endpoints against unprivileged users (vault paths, providers
# AI). Aplicat a router-level.
router = APIRouter(dependencies=[Depends(require_role("admin"))])
log = logging.getLogger(__name__)

# Gnosi may manage only its repository-local configuration. A shared env file
# is an operator-owned, read-only input selected through GNOSI_SHARED_ENV_FILE.
ENV_PATH = LOCAL_ENV


def parse_env_file(filepath: Path) -> tuple[dict[str, str], list[str]]:
    """Parse .env file and return dict of key-value pairs, preserving comments."""
    env_vars: dict[str, str] = {}
    lines: list[str] = []

    if not filepath.exists():
        return env_vars, lines

    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for line in lines:
        stripped = line.strip()
        # Skip empty lines and comments
        if not stripped or stripped.startswith("#"):
            continue

        # Parse KEY=VALUE
        match = re.match(r"^([A-Z_][A-Z0-9_]*)=(.*)$", stripped)
        if match:
            key, value = match.groups()
            env_vars[key] = value.strip()

    return env_vars, lines


def write_env_file(
    filepath: Path,
    env_vars: dict[str, str],
    original_lines: list[str],
) -> None:
    """Write Gnosi's local env file while preserving comments and structure."""
    new_lines = []
    processed_keys = set()

    for line in original_lines:
        stripped = line.strip()

        # Keep empty lines and comments as-is
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue

        # Update existing key-value pairs
        match = re.match(r"^([A-Z_][A-Z0-9_]*)=(.*)$", stripped)
        if match:
            key = match.group(1)
            if key in env_vars:
                new_lines.append(f"{key}={env_vars[key]}\n")
                processed_keys.add(key)
            else:
                # Keep line as-is if key not in new env_vars
                new_lines.append(line)
        else:
            new_lines.append(line)

    # Add new keys that weren't in the original file
    for key, value in env_vars.items():
        if key not in processed_keys:
            new_lines.append(f"{key}={value}\n")

    safe_write_text(filepath, "".join(new_lines))


@router.get("/env", response_model=None)
async def get_env() -> Any:
    """Get environment variables from .env file (tokens are masked)."""
    try:
        env_vars, _ = parse_env_file(ENV_PATH)

        # Mask sensitive values. The previous predicate only covered TOKEN/KEY,
        # so PASSWORD/SECRET/DSN/credential-bearing URLs were returned in the
        # clear. Fully redact anything that looks secret (no partial reveal),
        # and also redact any value that embeds `user:pass@` credentials.
        cred_url_re = re.compile(r"://[^/@\s]+:[^/@\s]+@")
        masked_vars = {}
        for key, value in env_vars.items():
            if is_sensitive_env_key(key) or cred_url_re.search(value or ""):
                masked_vars[key] = "********" if value else ""
            else:
                masked_vars[key] = value

        return masked_vars

    except Exception as e:
        log.error(f"Error reading .env file: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="GET /env"))


@router.post("/env", response_model=None)
async def update_env(request: Request) -> Any:
    """Update local settings and route credentials to secure storage."""
    try:
        new_vars = await request.json()
        if not isinstance(new_vars, dict) or not new_vars:
            raise HTTPException(status_code=400, detail="No data provided")

        # Read current .env file
        current_vars, original_lines = parse_env_file(ENV_PATH)

        secure_updates = 0
        for key, value in new_vars.items():
            normalized_key = str(key or "").strip().upper()
            if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", normalized_key):
                raise HTTPException(status_code=400, detail=f"Invalid environment key: {key}")
            text_value = str(value or "")
            if text_value.startswith("***"):
                continue

            secure_key = keychain_key_for_env(normalized_key)
            if secure_key:
                if text_value:
                    if not get_keychain().save_credential(secure_key, text_value):
                        raise HTTPException(
                            status_code=503,
                            detail=f"Secure storage is unavailable for {normalized_key}",
                        )
                    os.environ[normalized_key] = text_value
                    secure_updates += 1
                else:
                    get_keychain().delete_credential(secure_key)
                    os.environ.pop(normalized_key, None)
                current_vars.pop(normalized_key, None)
                continue

            current_vars[normalized_key] = text_value

        # Write back to file
        write_env_file(ENV_PATH, current_vars, original_lines)
        load_env(force_reload=True)

        log.info(
            "Updated local environment settings: total=%s secure=%s",
            len(new_vars),
            secure_updates,
        )
        return {
            "status": "success",
            "message": "Environment variables updated",
            "secure_updates": secure_updates,
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating .env file: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /env"))
