"""Paritat del conjunt de veritat de checkbox entre els 4 motors.

asBool (vaultFilters.js), FILTER_TRUTHY (DbViewEmbed) i _TRUTHY
(view_snapshot) inclouen "sí" ACCENTUAT i declaren paritat amb
rule_engine._is_truthy_checkbox — que no el tenia: una casella desada en
català ("sí") comptava com a marcada a filtres/vistes/snapshot però NO al
rollup percent_checked (percentatge infravalorat en silenci).
"""
import pytest

from backend.services.rule_engine import RuleEngine
from backend.services.view_snapshot import _as_bool

TRUTHY_CASES = ["true", "1", "yes", "si", "sí", "SÍ", " Sí ", "done", "checked", "completat", True, 1]
FALSY_CASES = ["", "false", "no", "0", None, False, 0]


@pytest.mark.parametrize("value", TRUTHY_CASES)
def test_rule_engine_marks_truthy(value):
    assert RuleEngine._is_truthy_checkbox(value) is True


@pytest.mark.parametrize("value", FALSY_CASES)
def test_rule_engine_marks_falsy(value):
    assert RuleEngine._is_truthy_checkbox(value) is False


@pytest.mark.parametrize("value", TRUTHY_CASES + FALSY_CASES)
def test_parity_with_view_snapshot(value):
    # Els dos motors backend han de coincidir per a TOTS els casos.
    assert RuleEngine._is_truthy_checkbox(value) == _as_bool(value)
