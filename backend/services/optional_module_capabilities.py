"""Side-effect-free availability checks for optional Python modules."""

from __future__ import annotations

import importlib.util


def module_available(module: str) -> bool:
    """Return whether a module is importable without executing its code."""
    try:
        return importlib.util.find_spec(module) is not None
    except Exception:
        return False
