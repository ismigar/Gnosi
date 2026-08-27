#!/usr/bin/env python3
"""
Migrate credentials from .env_shared to Keychain.

This script:
1. Reads an explicitly selected environment file
2. Identifies credential variables (API keys, tokens, passwords)
3. Migrates them to macOS Keychain (or file fallback)
4. Leaves the source file unchanged

Usage:
    GNOSI_SHARED_ENV_FILE=/absolute/path/.env_shared python scripts/migrate-to-keychain.py
"""

import os
import sys
from pathlib import Path

CREDENTIAL_PATTERNS = [
    "TOKEN",
    "API_KEY",
    "PASSWORD",
    "SECRET",
    "PRIVATE_KEY",
    "CREDENTIAL",
    "AUTH",
    "BEARER",
    "CLIENT_SECRET",
]

EXCLUDED_PATTERNS = [
    "_ID",
    "_URL",
    "_PATH",
    "_PORT",
    "_SERVER",
    "_EMAIL",
    "_USER",
    "HANDLE",
    "CHAT_ID",
    "_FOLDER_ID",
    "_DATABASE_ID",
    "_ORG",
    "REDIRECT",
    "INSTANCE",
]

SENSITIVE_KEYS = [
    "NOTION_TOKEN",
    "HF_API_KEY",
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "N8N_API_KEY",
    "N8N_PASSWORD",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "SSH_PASSWORD",
    "SSH_SUWEB_PASSWORD",
    "DRUPAL_ROOT_PASSWORD",
    "NEWSLETTERS_PASSWORD",
    "IMAP_PASS",
    "TEMENOS_MASTODON_BEARER",
    "TEMENOS_BLUESKY_APP_PASSWORD",
]


def is_credential(key: str, value: str) -> bool:
    """Check if a variable is a credential."""
    if not value or value.strip() == "":
        return False

    key_upper = key.upper()

    if key in SENSITIVE_KEYS:
        return True

    for pattern in CREDENTIAL_PATTERNS:
        if pattern in key_upper:
            for excluded in EXCLUDED_PATTERNS:
                if excluded in key_upper:
                    break
            else:
                return True

    return False


def get_env_path(explicit_path: str | None = None) -> Path:
    """Resolve an explicitly supplied shared environment file."""
    raw = explicit_path or os.environ.get("GNOSI_SHARED_ENV_FILE")
    if not raw:
        raise ValueError("Provide --source or configure GNOSI_SHARED_ENV_FILE")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ValueError("The shared environment source must be an absolute path")
    return path


def load_env_file(path: Path) -> dict:
    """Load environment variables from .env file."""
    env_vars = {}
    if path.exists():
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    env_vars[key.strip()] = value.strip()
    return env_vars


def format_key_for_keychain(key: str) -> str:
    """Format key name for keychain storage."""
    key_map = {
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
    return key_map.get(key, key.lower())


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Migrate credentials to Keychain")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be migrated without making changes",
    )
    parser.add_argument("--source", help="Absolute environment file to import")
    parser.add_argument("--force", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    try:
        env_path = get_env_path(args.source)
    except ValueError as exc:
        print(f"❌ Error: {exc}")
        sys.exit(2)

    if not env_path.exists():
        print(f"❌ Error: {env_path} not found")
        sys.exit(1)

    env_vars = load_env_file(env_path)
    credentials = {k: v for k, v in env_vars.items() if is_credential(k, v)}

    if not credentials:
        print("✅ No credentials found to migrate")
        sys.exit(0)

    print("=" * 60)
    print("CREDENTIALS MIGRATION TO KEYCHAIN")
    print("=" * 60)
    print(f"\nFound {len(credentials)} credentials in {env_path}:\n")

    for key in sorted(credentials.keys()):
        print(f"  • {key}")

    print(f"\nTarget: macOS Keychain (service: gnosi-app)")

    if args.dry_run:
        print("\n🔍 DRY RUN - No changes will be made")
        sys.exit(0)

    if not args.force:
        response = input("\n❓ Proceed with migration? [y/N] ")
        if response.lower() not in ("y", "yes"):
            print("Cancelled.")
            sys.exit(0)

    gnosi_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(gnosi_root))
    from backend.security.keychain_manager import get_keychain

    keychain = get_keychain()

    migrated = []
    failed = []

    print("\n📦 Migrating credentials...\n")

    for key, value in sorted(credentials.items()):
        keychain_key = format_key_for_keychain(key)
        success = keychain.save_credential(keychain_key, value)

        if success:
            migrated.append(key)
            print(f"  ✅ {key}")
        else:
            failed.append(key)
            print(f"  ❌ {key} - FAILED")

    print("\n🔒 Source file left unchanged (operator-owned, read-only input)")

    print("\n" + "=" * 60)
    print("MIGRATION COMPLETE")
    print("=" * 60)
    print(f"\n✅ Migrated: {len(migrated)}")
    if failed:
        print(f"❌ Failed: {len(failed)}")
    print("\n⚠️  IMPORTANT:")
    print("   1. Restart your app to load credentials from Keychain")
    print("   2. Test that the app works correctly")
    print("   3. Remove obsolete source credentials manually only after verification")


if __name__ == "__main__":
    main()
