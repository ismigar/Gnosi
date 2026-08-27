"""Runtime-mode contracts for native and packaged backend launches."""

import sys
from pathlib import Path

from backend.config.env_config import GNOSI_ROOT, PROJECTES_ROOT, is_frozen_runtime


def test_repository_roots_follow_the_tracked_apps_layout():
    """Root discovery remains valid after removing the legacy monorepo level."""
    expected_projectes_root = Path(__file__).resolve().parents[4]

    assert PROJECTES_ROOT == expected_projectes_root
    assert GNOSI_ROOT == expected_projectes_root / "apps" / "gnosi"


def test_regular_python_runtime_is_not_frozen(monkeypatch):
    """Development Python keeps uvicorn reload available."""
    monkeypatch.delattr(sys, "frozen", raising=False)

    assert is_frozen_runtime() is False


def test_pyinstaller_runtime_is_frozen(monkeypatch):
    """PyInstaller's runtime marker disables filesystem reload watchers."""
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    assert is_frozen_runtime() is True
