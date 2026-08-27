"""Characterize the compatibility surface retained by ``agent.factory``."""

from __future__ import annotations

import ast
import warnings
from pathlib import Path

from backend.agent import factory

BACKEND_ROOT = Path(__file__).parents[1]


def _consumer_symbols() -> set[str]:
    """Discover direct imports, attributes and monkeypatch seams in backend code."""
    names: set[str] = set()
    for source in BACKEND_ROOT.rglob("*.py"):
        if source == Path(factory.__file__).resolve() or source == Path(__file__).resolve():
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            module = ast.parse(source.read_text(encoding="utf-8"))
        for node in ast.walk(module):
            if isinstance(node, ast.ImportFrom) and node.module == "backend.agent.factory":
                names.update(alias.name for alias in node.names)
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id == "factory"
            ):
                names.add(node.attr)
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "setattr"
                and len(node.args) > 1
                and isinstance(node.args[0], ast.Name)
                and node.args[0].id == "factory"
                and isinstance(node.args[1], ast.Constant)
                and isinstance(node.args[1].value, str)
            ):
                names.add(node.args[1].value)
    return names


def test_factory_facade_exports_every_current_consumer_symbol() -> None:
    """No compatibility consumer may depend on an undeclared factory attribute."""
    required = _consumer_symbols()
    missing = sorted(name for name in required if not hasattr(factory, name))

    assert missing == []


def test_factory_all_declares_every_imported_compatibility_symbol() -> None:
    """The explicit facade inventory remains lint-stable and reviewable."""
    required = _consumer_symbols()
    declared = set(factory.__all__)

    assert sorted(required - declared) == []
