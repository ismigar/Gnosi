"""UNIFIED evaluation order for derived fields (formulas + rollups).

Regression test for the silent-corruption bug: previously formulas were evaluated
ENTIRELY before rollups, so a formula that read a rollup saw
the stale value from disk (or `None`) — it was one save behind. The fix is a
single topological dependency graph (`_order_definitions` +
`_definition_dependencies`) that mixes formulas AND rollups, with cycle
detection.

Rollups read RELATED rows from disk; here `_load_related_metadata` is mocked
so the test focuses on ORDER, not I/O.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pytest

from backend.services.rule_engine import RuleEngine


def _engine(tmp_path: Path, related: dict[str, dict] | None = None) -> RuleEngine:
    """RuleEngine with an empty vault and `_load_related_metadata` mocked by id."""
    engine = RuleEngine(tmp_path)
    lookup = related or {}
    engine._load_related_metadata = lambda rid: lookup.get(str(rid))  # type: ignore[assignment]
    return engine


def _formula(name: str, expression: str) -> dict:
    return {
        "id": f"f_{name}",
        "name": name,
        "type": "formula",
        "formula_config": {"expression": expression},
    }


def _rollup(name: str, relation_field: str, aggregation: str = "count_all") -> dict:
    return {
        "id": f"f_{name}",
        "name": name,
        "type": "rollup",
        "config": {"relationField": relation_field, "aggregation": aggregation},
    }


# --- E2E behavior: formula that depends on a rollup --------------------------

def test_formula_reads_freshly_recomputed_rollup(tmp_path):
    """`estat` depends on the `total_tasques` rollup: it must see the FRESH value.

    With the old order (formulas before rollups) `estat` was calculated with the
    stale `total_tasques` from disk (0) → "buit". Now the rollup is recalculated
    first (2) → "actiu".
    
    """
    table = {
        "id": "t_proj",
        "properties": [
            {"id": "f_rel", "name": "Tasques", "type": "relation"},
            _rollup("total_tasques", relation_field="Tasques"),
            _formula("estat", '"actiu" if total_tasques > 0 else "buit"'),
        ],
    }
    engine = _engine(tmp_path, related={"task1": {"title": "T1"}, "task2": {"title": "T2"}})

    # Stale values from disk: total_tasques=0 and estat="buit".
    metadata = {
        "database_table_id": "t_proj",
        "Tasques": ["task1", "task2"],
        "total_tasques": 0,
        "estat": "buit",
    }

    result = engine._evaluate_derived(metadata, table)

    assert result["total_tasques"] == 2, "el rollup s'ha de recalcular"
    assert result["estat"] == "actiu", "la fórmula ha de llegir el rollup FRESC, no el ranci"


# --- E2E behavior: rollup that depends on a formula (inverse case) ------------

def test_rollup_reads_freshly_computed_formula(tmp_path):
    """A rollup's `relation_field` is a formula: this must not regress.

    A naive swap (rollups before formulas) would break this case. The
    unified graph orders the `rel_ids` formula before the `recompte` rollup.
    
    """
    table = {
        "id": "t_x",
        "properties": [
            _formula("rel_ids", '"a,b,c"'),  # the formula produces the set of relations
            _rollup("recompte", relation_field="rel_ids"),
        ],
    }
    engine = _engine(
        tmp_path,
        related={"a": {"title": "A"}, "b": {"title": "B"}, "c": {"title": "C"}},
    )

    metadata = {"database_table_id": "t_x", "rel_ids": "", "recompte": 0}

    result = engine._evaluate_derived(metadata, table)

    assert result["rel_ids"] == "a,b,c", "la fórmula s'avalua primer"
    assert result["recompte"] == 3, "el rollup ha de veure el relation_field FRESC de la fórmula"


# --- Formula ↔ rollup cycle detection ---------------------------------------

def test_cycle_between_formula_and_rollup_is_detected_no_crash(tmp_path, caplog):
    """`campA` (formula) → `campB` (rollup) → `campA`: cycle. Must not crash."""
    table = {
        "id": "t_c",
        "properties": [
            _formula("campA", "campB + 1"),          # depends on the campB rollup
            _rollup("campB", relation_field="campA"),  # depends on the campA formula
        ],
    }
    engine = _engine(tmp_path)  # no relations → count_all 0
    metadata = {"database_table_id": "t_c", "campA": "", "campB": 0}

    with caplog.at_level(logging.WARNING, logger="backend.services.rule_engine"):
        result = engine._evaluate_derived(metadata, table)

    assert "cycle" in caplog.text.lower(), "s'ha de registrar l'avís de cicle"
    # Bounded pass: no exception and both fields end up written (deterministic).
    assert "campA" in result and "campB" in result


# --- Direct unit test of the graph: _order_definitions -------------------------------

def test_order_definitions_places_rollup_before_dependent_formula(tmp_path):
    engine = _engine(tmp_path)
    defs = [
        {"name": "estat", "kind": "formula",
         "expression": '"actiu" if total > 0 else "buit"', "mode": "always"},
        {"name": "total", "kind": "rollup", "relation_field": "Tasques"},
    ]
    ordered, cycles = engine._order_definitions(defs)
    names = [d["name"] for d in ordered]

    assert not cycles
    assert names.index("total") < names.index("estat")


def test_order_definitions_places_formula_before_dependent_rollup(tmp_path):
    engine = _engine(tmp_path)
    defs = [
        {"name": "recompte", "kind": "rollup", "relation_field": "rel_ids"},
        {"name": "rel_ids", "kind": "formula", "expression": '"a,b"', "mode": "always"},
    ]
    ordered, cycles = engine._order_definitions(defs)
    names = [d["name"] for d in ordered]

    assert not cycles
    assert names.index("rel_ids") < names.index("recompte")


def test_order_definitions_reports_mixed_cycle(tmp_path):
    engine = _engine(tmp_path)
    defs = [
        {"name": "campA", "kind": "formula", "expression": "campB + 1", "mode": "always"},
        {"name": "campB", "kind": "rollup", "relation_field": "campA"},
    ]
    ordered, cycles = engine._order_definitions(defs)

    assert ordered == []
    assert {d["name"] for d in cycles} == {"campA", "campB"}


def test_formula_only_table_still_orders_by_deps(tmp_path):
    """No regression: without rollups, the inter-formula order is preserved."""
    engine = _engine(tmp_path)
    defs = [
        {"name": "total", "kind": "formula", "expression": "subtotal * 1.21", "mode": "always"},
        {"name": "subtotal", "kind": "formula", "expression": "preu * quantitat", "mode": "always"},
    ]
    ordered, cycles = engine._order_definitions(defs)
    names = [d["name"] for d in ordered]

    assert not cycles
    assert names.index("subtotal") < names.index("total")
