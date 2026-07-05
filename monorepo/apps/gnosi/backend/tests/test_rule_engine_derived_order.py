"""Ordre d'evaluació UNIFICAT de camps derivats (fórmules + rollups).

Regressió del bug de corrupció silenciosa: abans les fórmules s'avaluaven
SENCERES abans que els rollups, així que una fórmula que llegia un rollup veia
el valor ranci de disc (o `None`) — anava un desat endarrerida. El fix és un
únic graf de dependències topològic (`_order_definitions` +
`_definition_dependencies`) que barreja fórmules I rollups, amb detecció de
cicles.

Els rollups llegeixen files RELACIONADES de disc; aquí es mocka
`_load_related_metadata` perquè el test es concentri en l'ORDRE, no en l'I/O.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pytest

from backend.services.rule_engine import RuleEngine


def _engine(tmp_path: Path, related: dict[str, dict] | None = None) -> RuleEngine:
    """RuleEngine amb vault buit i `_load_related_metadata` mockat per id."""
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


# --- Comportament E2E: fórmula que depèn d'un rollup --------------------------

def test_formula_reads_freshly_recomputed_rollup(tmp_path):
    """`estat` depèn del rollup `total_tasques`: ha de veure el valor FRESC.

    Amb l'ordre antic (fórmules abans que rollups) `estat` es calculava amb el
    `total_tasques` ranci de disc (0) → "buit". Ara el rollup es recalcula
    primer (2) → "actiu".
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

    # Valors rancis de disc: total_tasques=0 i estat="buit".
    metadata = {
        "database_table_id": "t_proj",
        "Tasques": ["task1", "task2"],
        "total_tasques": 0,
        "estat": "buit",
    }

    result = engine._evaluate_derived(metadata, table)

    assert result["total_tasques"] == 2, "el rollup s'ha de recalcular"
    assert result["estat"] == "actiu", "la fórmula ha de llegir el rollup FRESC, no el ranci"


# --- Comportament E2E: rollup que depèn d'una fórmula (cas invers) ------------

def test_rollup_reads_freshly_computed_formula(tmp_path):
    """El `relation_field` d'un rollup és una fórmula: no s'ha de regredir.

    Un swap ingenu (rollups abans que fórmules) trencaria aquest cas. El graf
    unificat ordena la fórmula `rel_ids` abans del rollup `recompte`.
    """
    table = {
        "id": "t_x",
        "properties": [
            _formula("rel_ids", '"a,b,c"'),  # la fórmula produeix el conjunt de relacions
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


# --- Detecció de cicle fórmula ↔ rollup ---------------------------------------

def test_cycle_between_formula_and_rollup_is_detected_no_crash(tmp_path, caplog):
    """`campA` (fórmula) → `campB` (rollup) → `campA`: cicle. No ha de petar."""
    table = {
        "id": "t_c",
        "properties": [
            _formula("campA", "campB + 1"),          # depèn del rollup campB
            _rollup("campB", relation_field="campA"),  # depèn de la fórmula campA
        ],
    }
    engine = _engine(tmp_path)  # sense relacions → count_all 0
    metadata = {"database_table_id": "t_c", "campA": "", "campB": 0}

    with caplog.at_level(logging.WARNING, logger="backend.services.rule_engine"):
        result = engine._evaluate_derived(metadata, table)

    assert "cycle" in caplog.text.lower(), "s'ha de registrar l'avís de cicle"
    # Passada acotada: sense excepció i tots dos camps queden escrits (determinista).
    assert "campA" in result and "campB" in result


# --- Unit directe del graf: _order_definitions -------------------------------

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
    """No regressió: sense rollups, l'ordre inter-fórmules es manté."""
    engine = _engine(tmp_path)
    defs = [
        {"name": "total", "kind": "formula", "expression": "subtotal * 1.21", "mode": "always"},
        {"name": "subtotal", "kind": "formula", "expression": "preu * quantitat", "mode": "always"},
    ]
    ordered, cycles = engine._order_definitions(defs)
    names = [d["name"] for d in ordered]

    assert not cycles
    assert names.index("subtotal") < names.index("total")
