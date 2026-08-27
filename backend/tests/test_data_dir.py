from pathlib import Path

import pytest

from backend.config.data_dir import (
    default_data_dir,
    reset_data_dir_warning_for_tests,
    resolve_data_dir,
)


def test_platform_defaults_are_native_and_stable(tmp_path):
    assert default_data_dir(system_name="Darwin", home=tmp_path, docker=False) == (
        tmp_path / "Library" / "Application Support" / "Gnosi"
    )
    assert default_data_dir(
        system_name="Linux", environ={}, home=tmp_path, docker=False
    ) == tmp_path / ".local" / "share" / "gnosi"
    assert default_data_dir(
        system_name="Linux",
        environ={"XDG_DATA_HOME": "/srv/user-data"},
        home=tmp_path,
        docker=False,
    ) == Path("/srv/user-data/gnosi")
    assert default_data_dir(
        system_name="Windows",
        environ={"APPDATA": "C:/Users/example/AppData/Roaming"},
        home=tmp_path,
        docker=False,
    ) == Path("C:/Users/example/AppData/Roaming/Gnosi")
    assert default_data_dir(system_name="Darwin", home=tmp_path, docker=True) == Path("/data")


def test_canonical_override_wins_over_legacy_alias(tmp_path):
    canonical = tmp_path / "canonical"
    legacy = tmp_path / "legacy"
    environ = {
        "GNOSI_DATA_DIR": str(canonical),
        "GNOSI_LOCAL_DATA": str(legacy),
    }

    assert resolve_data_dir(environ=environ, docker=False) == canonical


def test_legacy_alias_warns_once_and_exports_canonical_name(tmp_path):
    reset_data_dir_warning_for_tests()
    environ = {"GNOSI_LOCAL_DATA": str(tmp_path / "legacy")}

    with pytest.warns(FutureWarning, match="GNOSI_DATA_DIR"):
        resolved = resolve_data_dir(environ=environ, docker=False)
    with warnings_are_errors():
        assert resolve_data_dir(environ=environ, docker=False) == resolved

    assert environ["GNOSI_DATA_DIR"] == str(resolved)


class warnings_are_errors:
    """Small context manager that fails if the one-time warning repeats."""

    def __enter__(self):
        import warnings

        self._context = warnings.catch_warnings()
        self._context.__enter__()
        warnings.simplefilter("error")

    def __exit__(self, *args):
        return self._context.__exit__(*args)


def test_create_makes_only_the_resolved_directory(tmp_path):
    target = tmp_path / "data"
    resolved = resolve_data_dir(
        environ={"GNOSI_DATA_DIR": str(target)},
        docker=False,
        create=True,
    )
    assert resolved == target
    assert target.is_dir()
