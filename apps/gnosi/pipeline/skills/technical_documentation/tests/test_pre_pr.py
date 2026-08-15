"""Tests for the engineering-documentation pre-PR gate."""

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
        "Verify generated reference"
    )
    assert labels[:2] == [
        "Test documentation tooling",
        "Require documentation for functional changes",
    ]


def test_check_only_mode_never_writes_generated_pages():
    """Read-only automation must reject stale catalogs without mutating them."""
    labels = command_labels(check_only=True)

    assert "Update generated reference" not in labels
    assert "Verify generated reference" in labels


def test_gate_builds_every_supported_documentation_locale():
    """The local gate must cover the same strict locale portals as CI."""
    labels = command_labels(check_only=False)

    assert labels[-3:] == [
        "Build English portal",
        "Build Catalan portal",
        "Build Spanish portal",
    ]
