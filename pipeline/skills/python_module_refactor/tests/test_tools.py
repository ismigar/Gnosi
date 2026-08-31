from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.skills.python_module_refactor.scripts.analyze_symbol_graph import (
    build_report,
)
from pipeline.skills.python_module_refactor.scripts.extract_top_level_symbols import (
    extract_symbols,
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
    rows = first["symbols"]
    assert isinstance(rows, list)
    symbols: dict[str, dict[str, object]] = {}
    for row in rows:
        assert isinstance(row, dict)
        assert all(isinstance(key, str) for key in row)
        name = row["name"]
        assert isinstance(name, str)
        symbols[name] = row
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


def test_extract_symbols_moves_decorators_constants_and_is_idempotent(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.py"
    destination = tmp_path / "domain.py"
    source.write_text(
        "from object import object\n"
        "\n"
        "LIMIT = 3\n"
        "\n"
        "def decorator(function):\n"
        "    return function\n"
        "\n"
        "@decorator\n"
        "def selected() -> int:\n"
        "    return LIMIT\n"
        "\n"
        "def untouched() -> str:\n"
        "    return 'same'\n",
        encoding="utf-8",
    )
    preamble = "from __future__ import annotations\n\ndef decorator(function):\n    return function"
    source_import = "from domain import LIMIT, selected"

    assert (
        extract_symbols(
            source,
            destination,
            ["LIMIT", "selected"],
            destination_preamble=preamble,
            source_import=source_import,
        )
        is True
    )
    assert (
        extract_symbols(
            source,
            destination,
            ["LIMIT", "selected"],
            destination_preamble=preamble,
            source_import=source_import,
        )
        is False
    )
    assert source_import in source.read_text(encoding="utf-8")
    assert "def untouched" in source.read_text(encoding="utf-8")
    moved = destination.read_text(encoding="utf-8")
    assert "LIMIT = 3" in moved
    assert "@decorator" in moved
    assert "def selected" in moved


def test_extract_symbols_rejects_partial_state(tmp_path: Path) -> None:
    source = tmp_path / "source.py"
    source.write_text("def first() -> None:\n    pass\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Partial extraction state"):
        extract_symbols(
            source,
            tmp_path / "domain.py",
            ["first", "missing"],
            destination_preamble="from __future__ import annotations",
            source_import="from domain import first, missing",
        )


def test_extract_symbols_ignores_unrelated_duplicate_assignments(tmp_path: Path) -> None:
    source = tmp_path / "source.py"
    destination = tmp_path / "domain.py"
    source.write_text(
        "LEGACY = 1\nLEGACY = 2\n\ndef selected() -> str:\n    return 'moved'\n",
        encoding="utf-8",
    )

    assert (
        extract_symbols(
            source,
            destination,
            ["selected"],
            destination_preamble="from __future__ import annotations",
            source_import="from domain import selected",
        )
        is True
    )
    assert source.read_text(encoding="utf-8").count("LEGACY =") == 2


def test_extract_symbols_rejects_requested_duplicate_assignment(tmp_path: Path) -> None:
    source = tmp_path / "source.py"
    source.write_text("SELECTED = 1\nSELECTED = 2\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Duplicate top-level symbols.*SELECTED"):
        extract_symbols(
            source,
            tmp_path / "domain.py",
            ["SELECTED"],
            destination_preamble="from __future__ import annotations",
            source_import="from domain import SELECTED",
        )
