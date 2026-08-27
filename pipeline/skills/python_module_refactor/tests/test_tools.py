from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.skills.python_module_refactor.scripts.analyze_symbol_graph import (
    build_report,
)
from pipeline.skills.python_module_refactor.scripts.replace_top_level_function import (
    replace_function,
)


def test_symbol_graph_is_deterministic_and_reports_routes(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text(
        "router = object()\n"
        "\n"
        "def helper() -> int:\n"
        "    return 1\n"
        "\n"
        "@router.get('/items')\n"
        "def handler() -> int:\n"
        "    return helper()\n",
        encoding="utf-8",
    )

    first = build_report(source)
    second = build_report(source)

    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert first["format"] == "gnosi-python-symbol-graph-v1"
    assert first["edge_count"] == 2
    symbols = {row["name"]: row for row in first["symbols"]}
    assert symbols["handler"]["dependencies"] == ["helper", "router"]
    assert symbols["handler"]["routes"] == ["router.get('/items')"]


def test_replace_function_includes_decorators_and_is_idempotent(
    tmp_path: Path,
) -> None:
    source = tmp_path / "module.py"
    source.write_text(
        "def decorator(function):\n"
        "    return function\n"
        "\n"
        "@decorator\n"
        "def selected() -> str:\n"
        "    return 'old'\n"
        "\n"
        "def untouched() -> str:\n"
        "    return 'same'\n",
        encoding="utf-8",
    )
    replacement = "def selected() -> str:\n    return 'new'\n"

    assert replace_function(source, "selected", replacement) is True
    assert replace_function(source, "selected", replacement) is False
    updated = source.read_text(encoding="utf-8")
    assert "@decorator" not in updated
    assert "return 'new'" in updated
    assert "return 'same'" in updated


def test_replace_function_rejects_wrong_definition(tmp_path: Path) -> None:
    source = tmp_path / "module.py"
    source.write_text("def selected() -> None:\n    pass\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Replacement must define only"):
        replace_function(source, "selected", "def another() -> None:\n    pass\n")
