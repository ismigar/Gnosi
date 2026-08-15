from fastapi import APIRouter, Depends, HTTPException, Request
from pathlib import Path
import logging
import re

from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text
from backend.services.workspace_service import require_role

# Auth gate: in personal mode the user is auto-promoted to "owner" so
# require_role("admin") doesn't block. In organization mode it protects the
# env endpoints against unprivileged users (vault paths, providers
# AI). Aplicat a router-level.
router = APIRouter(dependencies=[Depends(require_role("admin"))])
log = logging.getLogger(__name__)

# Secrets: .env_shared (Projectes root)
try:
    ENV_PATH = Path(__file__).resolve().parents[5] / ".env_shared"
except IndexError:
    ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def parse_env_file(filepath):
    """Parse .env file and return dict of key-value pairs, preserving comments."""
    env_vars = {}
    lines = []

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


def write_env_file(filepath, env_vars, original_lines):
    """Write env vars back to file, preserving comments and structure."""
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

    # Atomic write: .env_shared is the source of all secrets — a crash
    # halfway through writelines would leave the file corrupt and the app would be left
    # without credentials on the next restart.
    safe_write_text(filepath, "".join(new_lines))


@router.get("/env")
async def get_env():
    """Get environment variables from .env file (tokens are masked)."""
    try:
        env_vars, _ = parse_env_file(ENV_PATH)

        # Mask sensitive values. The previous predicate only covered TOKEN/KEY,
        # so PASSWORD/SECRET/DSN/credential-bearing URLs were returned in the
        # clear. Fully redact anything that looks secret (no partial reveal),
        # and also redact any value that embeds `user:pass@` credentials.
        sensitive_markers = (
            "TOKEN", "KEY", "SECRET", "PASSWORD", "PASS", "DSN",
            "CREDENTIAL", "PRIVATE",
        )
        cred_url_re = re.compile(r"://[^/@\s]+:[^/@\s]+@")
        masked_vars = {}
        for key, value in env_vars.items():
            upper = key.upper()
            if any(marker in upper for marker in sensitive_markers) or cred_url_re.search(value or ""):
                masked_vars[key] = "********" if value else ""
            else:
                masked_vars[key] = value

        return masked_vars

    except Exception as e:
        log.error(f"Error reading .env file: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="GET /env"))


@router.post("/env")
async def update_env(request: Request):
    """Update environment variables in .env file."""
    try:
        new_vars = await request.json()
        if not new_vars:
            raise HTTPException(status_code=400, detail="No data provided")

        # Read current .env file
        current_vars, original_lines = parse_env_file(ENV_PATH)

        # Merge with new values
        # Only update keys that are provided and not masked
        for key, value in new_vars.items():
            # Skip if value is masked (contains '...')
            if "..." in str(value):
                continue

            # Update or add the key
            current_vars[key] = value

        # Write back to file
        write_env_file(ENV_PATH, current_vars, original_lines)

        log.info(f"Updated .env file with {len(new_vars)} variables")
        return {"status": "success", "message": "Environment variables updated"}

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating .env file: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /env"))
