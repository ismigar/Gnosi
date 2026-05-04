#!/usr/bin/env python3
"""
Migrate credentials from .env_shared to Keychain.

This script:
1. Reads .env_shared
2. Identifies credential variables (API keys, tokens, passwords)
3. Migrates them to macOS Keychain (or file fallback)
4. Creates a backup of .env_shared
5. Optionally removes credentials from .env_shared

Usage:
    python migrate_to_keychain.py [--dry-run] [--keep-env]
"""

import os
import sys
import json
import shutil
from pathlib import Path
from datetime import datetime

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


def get_env_path() -> Path:
    """Get path to .env_shared."""
    script_dir = Path(__file__).resolve().parent
    projectes_root = script_dir.parent.parent.parent
    return projectes_root / ".env_shared"


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
    return key_map.get(key, key.lower())


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Migrate credentials to Keychain")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be migrated without making changes",
    )
    parser.add_argument(
        "--keep-env",
        action="store_true",
        help="Keep credentials in .env_shared after migration",
    )
    parser.add_argument("--force", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()

    env_path = get_env_path()

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
        value = credentials[key]
        masked = value[:8] + "..." + value[-4:] if len(value) > 12 else "***"
        print(f"  • {key}: {masked}")

    print(f"\nTarget: macOS Keychain (service: gnosi-app)")

    if args.dry_run:
        print("\n🔍 DRY RUN - No changes will be made")
        sys.exit(0)

    if not args.force:
        response = input("\n❓ Proceed with migration? [y/N] ")
        if response.lower() not in ("y", "yes"):
            print("Cancelled.")
            sys.exit(0)

    sys.path.insert(0, str(Path(__file__).parent))
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

    backup_path = env_path.with_suffix(
        f".shared.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    )
    shutil.copy2(env_path, backup_path)
    print(f"\n💾 Backup created: {backup_path}")

    if not args.keep_env:
        print(f"\n🧹 Cleaning .env_shared...")
        with open(env_path, "w") as f:
            for key, value in env_vars.items():
                if key not in credentials:
                    f.write(f"{key}={value}\n")
                else:
                    f.write(f"# MIGRATED_TO_KEYCHAIN: {key}=\n")

        print(f"  • {len(credentials)} credentials commented out")
    else:
        print("\n⚠️  .env_shared kept as-is (credentials still present)")

    print("\n" + "=" * 60)
    print("MIGRATION COMPLETE")
    print("=" * 60)
    print(f"\n✅ Migrated: {len(migrated)}")
    if failed:
        print(f"❌ Failed: {len(failed)}")
    print(f"\n📝 Log file: {backup_path}")
    print("\n⚠️  IMPORTANT:")
    print("   1. Restart your app to load credentials from Keychain")
    print("   2. Test that the app works correctly")
    print("   3. Commit .env_shared changes (credentials are commented)")


if __name__ == "__main__":
    main()
