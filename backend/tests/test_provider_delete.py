"""Unit tests for provider disconnection semantics.

The tests cover pure cascade/config helpers and isolated managed-env cleanup.
They never access the real keychain, params file, or environment files.
"""
import os

import backend.security.ai_credentials as creds
from backend.api.ai_routes import (
    _registry_rows_without_provider,
    _set_provider_disconnected,
)
from backend.config.app_config import apply_env_provider_migration
from backend.config.env_config import remove_env_keys


def test_registry_rows_without_provider_filters_and_counts():
    registry = [
        {"provider": "groq", "model_id": "a"},
        {"provider": "openai", "model_id": "b"},
        {"provider": "groq", "model_id": "c"},
    ]
    filtered, removed = _registry_rows_without_provider(registry, "groq")
    assert [m["model_id"] for m in filtered] == ["b"]
    assert removed == 2
    # No match → untouched list, zero removed (caller skips the write)
    same, none_removed = _registry_rows_without_provider(registry, "mistral")
    assert same == registry and none_removed == 0
    assert _registry_rows_without_provider([], "groq") == ([], 0)
    assert _registry_rows_without_provider(None, "groq") == ([], 0)


def test_is_provider_connected_respects_enabled_flag(monkeypatch):
    # Credentials present, but the user toggled the provider OFF → not
    # connected (same semantics as the router's availability check).
    monkeypatch.setattr(creds, "has_provider_api_key", lambda *_: True)
    assert creds.is_provider_connected("groq", {"enabled": False}) is False
    assert creds.is_provider_connected("groq", {"enabled": True}) is True
    assert creds.is_provider_connected("groq", {}) is True  # default enabled
    # Local providers need no key — but disabled still wins
    assert creds.is_provider_connected("ollama", {"enabled": False}) is False
    assert creds.is_provider_connected("ollama", {}) is True


def test_migrate_pops_empty_api_key(monkeypatch):
    # The edit modal posts api_key: "" — it must never persist to params.yaml
    monkeypatch.setattr(creds, "set_provider_api_key",
                        lambda *_: (True, "__keychain__:x"))
    migrated, changed = creds.migrate_ai_provider_secrets(
        {"providers": {"groq": {"api_key": "", "base_url": "https://x"}}})
    assert changed is True
    assert "api_key" not in migrated["providers"]["groq"]
    assert migrated["providers"]["groq"]["base_url"] == "https://x"


def test_disconnected_provider_is_not_recreated_from_environment():
    params = {
        "ai": {
            "providers": {},
            "disconnected_providers": ["openrouter"],
        }
    }
    changed = apply_env_provider_migration(
        params,
        {"OPENROUTER_API_KEY": "legacy-environment-key"},
    )
    assert changed is False
    assert params["ai"]["providers"] == {}


def test_provider_reconnect_clears_persistent_tombstone():
    ai_cfg = {"disconnected_providers": ["groq", "openrouter"]}
    assert _set_provider_disconnected(ai_cfg, "openrouter", False) is True
    assert ai_cfg["disconnected_providers"] == ["groq"]
    assert _set_provider_disconnected(ai_cfg, "openrouter", False) is False


def test_provider_delete_adds_persistent_tombstone_once():
    ai_cfg = {}
    assert _set_provider_disconnected(ai_cfg, "openrouter", True) is True
    assert ai_cfg["disconnected_providers"] == ["openrouter"]
    assert _set_provider_disconnected(ai_cfg, "openrouter", True) is False


def test_remove_env_keys_deletes_managed_secret_and_preserves_other_lines(
    tmp_path,
    monkeypatch,
):
    env_path = tmp_path / ".env_shared"
    env_path.write_text(
        "# Provider credentials\n"
        "OPENROUTER_API_KEY=secret\n"
        "OTHER_SETTING=keep\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENROUTER_API_KEY", "secret")

    removed = remove_env_keys(["OPENROUTER_API_KEY"], [env_path])

    assert removed == ["OPENROUTER_API_KEY"]
    assert env_path.read_text(encoding="utf-8") == (
        "# Provider credentials\n"
        "OTHER_SETTING=keep\n"
    )
    assert "OPENROUTER_API_KEY" not in os.environ
