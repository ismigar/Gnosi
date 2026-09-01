"""Reference designation cannot cross the disposable validation boundary."""

from pathlib import Path

import pytest


def _isolate(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for directory in ("data", "vault", "host"):
        (root / directory).mkdir(parents=True)
    monkeypatch.setenv("GNOSI_VALIDATION_ROOT", str(root))
    for variable, directory in (
        ("GNOSI_DATA_DIR", "data"),
        ("DIGITAL_BRAIN_VAULT_PATH", "vault"),
        ("VAULT_HOST_PATH", "vault"),
        ("HOME_HOST_PATH", "host"),
    ):
        monkeypatch.setenv(variable, str(root / directory))


def test_reference_config_does_not_read_copy_or_overwrite_legacy_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate(tmp_path / "probe", monkeypatch)
    from backend.services import reference_table_config as config

    repository = tmp_path / "synthetic-repository"
    legacy = repository / "pipeline/skills/zotero_sync/zotero_db_config.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text('{"target_table": "outside-sentinel"}', encoding="utf-8")
    monkeypatch.setattr(config, "_BASE_DIR", repository)
    selected = config._config_path()
    assert selected == tmp_path / "probe/data/config/references.json"
    assert config.load_json(selected, {}) == {}
    config.save_json(selected, {"target_table": "synthetic-table"})
    assert config.load_json(selected, {}) == {"target_table": "synthetic-table"}
    assert legacy.read_text(encoding="utf-8") == '{"target_table": "outside-sentinel"}'


def test_reference_config_uses_canonical_storage_in_normal_runtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate(tmp_path / "probe", monkeypatch)
    from backend.services import reference_table_config as config

    monkeypatch.delenv("GNOSI_VALIDATION_ROOT")
    monkeypatch.setattr(config, "_BASE_DIR", tmp_path / "synthetic-repository")
    selected = config._config_path()
    assert selected == tmp_path / "probe/data/config/references.json"
    assert not selected.exists()


@pytest.mark.parametrize("variable", ["GNOSI_DATA_DIR", "VAULT_HOST_PATH", "HOME_HOST_PATH"])
def test_reference_config_rejects_incomplete_isolation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    variable: str,
) -> None:
    _isolate(tmp_path / "probe", monkeypatch)
    from backend.services import reference_table_config as config

    monkeypatch.delenv(variable)
    with pytest.raises(RuntimeError, match="inside its probe root"):
        config._config_path()


def test_normal_runtime_demands_explicit_migration_without_legacy_writes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate(tmp_path / "probe", monkeypatch)
    from backend.services import reference_table_config as config

    repository = tmp_path / "repository"
    legacy = repository / "pipeline/skills/zotero_sync/zotero_db_config.json"
    legacy.parent.mkdir(parents=True)
    original = '{"target_table":"", "references_configured":true, "extra":42}'
    legacy.write_text(original)
    monkeypatch.setattr(config, "_BASE_DIR", repository)
    monkeypatch.setattr(config, "CONFIG_PATH", config._config_path())
    # Only this selector policy is stubbed; global isolation stays enabled.
    monkeypatch.setattr(config, "validation_runtime_enabled", lambda: False)
    with pytest.raises(RuntimeError, match="explicit migration"):
        config.assert_reference_config_ready()
    with pytest.raises(RuntimeError, match="explicit migration"):
        config.load_json(config.CONFIG_PATH, {})
    with pytest.raises(RuntimeError, match="explicit migration"):
        config.save_json(config.CONFIG_PATH, {"target_table": "wrong"})
    assert not config.CONFIG_PATH.exists()
    assert legacy.read_text() == original
    from backend.services.reference_config_migration import migrate_reference_config

    migrate_reference_config(legacy, tmp_path / "probe/data", writers_stopped=True)
    config.assert_reference_config_ready()
    assert config.load_json(config.CONFIG_PATH, {}) == {
        "target_table": "",
        "references_configured": True,
        "extra": 42,
    }
    config.save_json(config.CONFIG_PATH, {"target_table": "explicit-choice", "extra": 42})
    assert legacy.read_text() == original


def test_lifespan_refuses_legacy_state_before_database_or_worker_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio

    from fastapi import FastAPI

    from backend.app.lifespan import lifespan
    from backend.migrations import coordinator
    from backend.services import reference_table_config as config

    def refuse() -> None:
        raise RuntimeError("explicit migration required")

    def unexpected(*args: object, **kwargs: object) -> None:
        pytest.fail("Database mutation must not run before configuration readiness")

    monkeypatch.setattr(config, "assert_reference_config_ready", refuse)
    monkeypatch.setattr(coordinator, "migrate_existing_databases", unexpected)

    async def start() -> None:
        async with lifespan(FastAPI()):
            pytest.fail("Startup must abort")

    with pytest.raises(RuntimeError, match="explicit migration required"):
        asyncio.run(start())
