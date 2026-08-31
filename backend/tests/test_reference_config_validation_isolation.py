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


def test_reference_config_preserves_normal_legacy_selection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate(tmp_path / "probe", monkeypatch)
    from backend.services import reference_table_config as config

    monkeypatch.delenv("GNOSI_VALIDATION_ROOT")
    monkeypatch.setattr(config, "_BASE_DIR", tmp_path / "synthetic-repository")
    selected = config._config_path()
    assert (
        selected
        == tmp_path / "synthetic-repository/pipeline/skills/zotero_sync/zotero_db_config.json"
    )
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
