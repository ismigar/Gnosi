"""Path discovery preserves repair behavior without repeated mkdir calls."""

from pathlib import Path

from backend.config import paths_config


def test_repeated_path_resolution_does_not_attempt_directory_creation(
    isolated_validation_runtime, monkeypatch
):
    first = paths_config.get_paths()
    calls = []
    original = Path.mkdir

    def mkdir(path, *args, **kwargs):
        calls.append(path)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", mkdir)
    assert paths_config.get_paths() == first
    assert calls == []
    missing = first["LOCAL_DATA"] / "out"
    missing.rmdir()
    assert paths_config.get_paths() == first
    assert calls == [missing]
    assert missing.is_dir()


def test_device_and_vault_changes_are_resolved_on_each_call(isolated_validation_runtime, monkeypatch):
    root = isolated_validation_runtime
    first = paths_config.get_paths()
    second_root = root.parent / "second-validation-runtime"
    for name in ["data", "vault", "host"]:
        (second_root / name).mkdir(parents=True)
    monkeypatch.setenv("GNOSI_VALIDATION_ROOT", str(second_root))
    for key, name in [
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ]:
        monkeypatch.setenv(key, str(second_root / name))
    second = paths_config.get_paths()
    assert second["LOCAL_DATA"] == second_root / "data"
    assert second["VAULT"] == second_root / "vault"
    assert second["SECRETS"].is_dir()
    assert first["LOCAL_DATA"] != second["LOCAL_DATA"]
    assert first["VAULT"] != second["VAULT"]


def test_checkout_resolution_is_reused_without_caching_vault_state(
    isolated_validation_runtime, monkeypatch
):
    paths_config._project_root.cache_clear()
    original = Path.resolve
    calls = []

    def resolve(path, *args, **kwargs):
        if path == Path(paths_config.__file__):
            calls.append(path)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", resolve)
    paths_config.get_paths()
    paths_config.get_paths()
    assert len(calls) == 1
