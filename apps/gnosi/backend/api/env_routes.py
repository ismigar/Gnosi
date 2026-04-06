from fastapi import APIRouter, HTTPException, Request
from pathlib import Path
import logging
import re

router = APIRouter()
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

    with open(filepath, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


@router.get("/env")
async def get_env():
    """Get environment variables from .env file (tokens are masked)."""
    try:
        env_vars, _ = parse_env_file(ENV_PATH)

        # Mask sensitive tokens for security
        masked_vars = {}
        for key, value in env_vars.items():
            if "TOKEN" in key or "KEY" in key:
                # Show only first 8 and last 4 characters
                if len(value) > 12:
                    masked_vars[key] = value[:8] + "..." + value[-4:]
                else:
                    masked_vars[key] = "***"
            else:
                masked_vars[key] = value

        return masked_vars

    except Exception as e:
        log.error(f"Error reading .env file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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

    except Exception as e:
        log.error(f"Error updating .env file: {e}")
        raise HTTPException(status_code=500, detail=str(e))
