"""Runtime-mode contracts for native and packaged backend launches."""

import sys

from backend.config.env_config import is_frozen_runtime


def test_regular_python_runtime_is_not_frozen(monkeypatch):
    """Development Python keeps uvicorn reload available."""
    monkeypatch.delattr(sys, "frozen", raising=False)

    assert is_frozen_runtime() is False


def test_pyinstaller_runtime_is_frozen(monkeypatch):
    """PyInstaller's runtime marker disables filesystem reload watchers."""
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    assert is_frozen_runtime() is True
