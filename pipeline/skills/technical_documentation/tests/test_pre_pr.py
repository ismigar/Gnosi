"""Tests for the engineering-documentation pre-PR gate."""

from pathlib import Path

import pytest

from pipeline.skills.technical_documentation.scripts import pre_pr
from pipeline.skills.technical_documentation.scripts.pre_pr import build_commands


def command_labels(*, check_only: bool) -> list[str]:
    """Return phase labels for a representative branch validation."""
    return [
        command.name
        for command in build_commands(base_ref="origin/main", check_only=check_only)
    ]


def test_update_mode_regenerates_before_verifying_catalogs():
    """Local pre-PR runs must write catalogs before enforcing a clean result."""
    labels = command_labels(check_only=False)

    assert labels.index("Update generated reference") < labels.index(
        "Update localized generated reference"
    ) < labels.index(
        "Verify generated reference"
    )
    commands = build_commands(base_ref="origin/main", check_only=False)
    refresh = commands[labels.index("Update localized generated reference")]
    assert refresh.arguments[1:] == (
        str(pre_pr.SCRIPT_DIR / "localize.py"), "--generated-only",
    )
    assert labels[:2] == [
        "Test documentation tooling",
        "Require documentation for functional changes",
    ]


def test_check_only_mode_never_writes_generated_pages():
    """Read-only automation must reject stale catalogs without mutating them."""
    labels = command_labels(check_only=True)

    assert "Update generated reference" not in labels
    assert "Update localized generated reference" not in labels
    assert "Verify generated reference" in labels
    locale_commands = [
        command for command in build_commands(base_ref=None, check_only=True)
        if command.arguments[1].endswith("localize.py")
    ]
    assert len(locale_commands) == 1
    assert locale_commands[0].arguments[-1] == "--check"


def test_gate_builds_every_supported_documentation_locale():
    """The local gate must cover the same strict locale portals as CI."""
    labels = command_labels(check_only=False)

    assert labels[-4:] == [
        "Build English portal",
        "Build Catalan portal",
        "Build Spanish portal",
        "Build French portal",
    ]


def test_check_only_stages_builds_outside_checkout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify execution wiring without running MkDocs or the global gate."""
    monkeypatch.setattr(pre_pr, "APP_ROOT", tmp_path)
    sentinel = tmp_path / "approved.md"
    sentinel.write_bytes(b"approved\r\n")
    build_paths: list[Path] = []
    calls: list[tuple[str, ...]] = []

    def fake_run(
        arguments: tuple[str, ...], *, cwd: Path, env: dict[str, str], check: bool,
    ) -> None:
        calls.append(arguments)
        assert cwd == tmp_path
        assert check is True
        assert env["PYTHONDONTWRITEBYTECODE"] == "1"
        assert not Path(env["XDG_CACHE_HOME"]).is_relative_to(tmp_path)
        if arguments[1:3] == ("-m", "pytest"):
            assert "no:cacheprovider" in arguments
        if arguments[1:3] == ("-m", "mkdocs"):
            site = Path(arguments[arguments.index("--site-dir") + 1])
            assert not site.is_relative_to(tmp_path)
            site.mkdir()
            (site / "index.html").write_bytes(b"fixture build output")
            build_paths.append(site)

    monkeypatch.setattr(pre_pr.subprocess, "run", fake_run)
    assert pre_pr.main(["--check-only"]) == 0
    assert len(build_paths) == len(set(build_paths)) == 4
    assert all(not path.exists() for path in build_paths)
    assert all("--generated-only" not in arguments for arguments in calls)
    assert list(tmp_path.iterdir()) == [sentinel]
    assert sentinel.read_bytes() == b"approved\r\n"
