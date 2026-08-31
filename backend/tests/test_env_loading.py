import os

import pytest

import backend.config.env_config as env_config


@pytest.fixture(autouse=True)
def _synthetic_environment_loader(tmp_path, monkeypatch):
    """Exercise file precedence without opening any host configuration/store."""
    monkeypatch.setattr(env_config, "PROJECT_ROOT", tmp_path)
    _reset_loader(monkeypatch, tmp_path / ".env")
    monkeypatch.delenv("GNOSI_SHARED_ENV_FILE", raising=False)
    monkeypatch.setattr(env_config, "_is_docker", lambda: False)

    def forbidden_keychain():
        pytest.fail("Environment file tests must not consult a credential store")

    monkeypatch.setattr(
        "backend.security.keychain_manager.get_keychain", forbidden_keychain
    )
    # Override only this unit's policy seam, after bounding all its inputs.
    # The outer validation root and every other module's guard stay active.
    monkeypatch.setattr(env_config, "validation_runtime_enabled", lambda: False)
    yield
    # load_env writes directly to os.environ, outside monkeypatch's tracking.
    # Clear only values loaded by this fixture, never the caller's loader state.
    env_config._clear_values_loaded_by_gnosi()


def _reset_loader(monkeypatch, local_env):
    monkeypatch.setattr(env_config, "LOCAL_ENV", local_env)
    monkeypatch.setattr(env_config, "ENV_LOCATIONS", [local_env])
    monkeypatch.setattr(env_config, "_loaded", False)
    monkeypatch.setattr(env_config, "_keychain_loaded", True)
    monkeypatch.setattr(env_config, "_loaded_file_values", {})
    monkeypatch.setattr(env_config, "_loaded_keychain_values", {})


def test_environment_precedence_is_process_then_local_then_shared(tmp_path, monkeypatch):
    key = "GNOSI_TEST_PRECEDENCE"
    shared_only = "GNOSI_TEST_SHARED_ONLY"
    local_only = "GNOSI_TEST_LOCAL_ONLY"
    shared = tmp_path / ".env_shared"
    local = tmp_path / ".env"
    shared.write_text(f"{key}=shared\n{shared_only}=shared\n", encoding="utf-8")
    local.write_text(f"{key}=local\n{local_only}=local\n", encoding="utf-8")
    _reset_loader(monkeypatch, local)
    monkeypatch.setenv("GNOSI_SHARED_ENV_FILE", str(shared))
    monkeypatch.setenv(key, "process")
    monkeypatch.delenv(shared_only, raising=False)
    monkeypatch.delenv(local_only, raising=False)

    env_config.load_env()

    assert os.environ[key] == "process"
    assert os.environ[local_only] == "local"
    assert os.environ[shared_only] == "shared"


def test_shared_env_is_not_discovered_implicitly(tmp_path, monkeypatch):
    key = "GNOSI_TEST_IMPLICIT_SHARED"
    local = tmp_path / "repo" / ".env"
    local.parent.mkdir()
    (tmp_path / ".env_shared").write_text(f"{key}=forbidden\n", encoding="utf-8")
    _reset_loader(monkeypatch, local)
    monkeypatch.delenv("GNOSI_SHARED_ENV_FILE", raising=False)
    monkeypatch.delenv(key, raising=False)

    env_config.load_env()

    assert key not in os.environ
    assert env_config.configured_shared_env_path() is None


def test_configured_shared_env_is_read_only_to_cleanup(tmp_path, monkeypatch):
    key = "GNOSI_TEST_SHARED_SECRET"
    shared = tmp_path / ".env_shared"
    shared.write_text(f"{key}=keep\n", encoding="utf-8")
    monkeypatch.setenv("GNOSI_SHARED_ENV_FILE", str(shared))
    monkeypatch.setenv(key, "keep")

    removed = env_config.remove_env_keys([key], [shared])

    assert removed == [key]
    assert shared.read_text(encoding="utf-8") == f"{key}=keep\n"
    assert key not in os.environ


def test_local_env_cleanup_does_not_touch_other_settings(tmp_path, monkeypatch):
    key = "GNOSI_TEST_LOCAL_SECRET"
    local = tmp_path / ".env"
    local.write_text(f"{key}=remove\nOTHER_SETTING=keep\n", encoding="utf-8")
    _reset_loader(monkeypatch, local)
    monkeypatch.delenv("GNOSI_SHARED_ENV_FILE", raising=False)
    monkeypatch.setenv(key, "remove")

    removed = env_config.remove_env_keys([key])

    assert removed == [key]
    assert local.read_text(encoding="utf-8") == "OTHER_SETTING=keep\n"
    assert key not in os.environ


def test_sensitive_environment_names_have_stable_secure_store_keys():
    assert env_config.keychain_key_for_env("OPENAI_API_KEY") == "openai_api_key"
    assert env_config.keychain_key_for_env("CUSTOM_PRIVATE_TOKEN") == (
        "env_custom_private_token"
    )
    assert env_config.keychain_key_for_env("SOFTCATALA_API_URL") is None
