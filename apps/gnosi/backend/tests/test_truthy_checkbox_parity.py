"""Parity of the checkbox truthy set across the 4 engines.

asBool (vaultFilters.js), FILTER_TRUTHY (DbViewEmbed), and _TRUTHY
(view_snapshot) include ACCENTED "sí" and claim parity with
rule_engine._is_truthy_checkbox — which didn't have it: a checkbox saved in
Catalan ("sí") counted as checked in filters/views/snapshot but NOT in the
percent_checked rollup (percentage silently undervalued).
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
    # The two backend engines must agree for ALL cases.
    assert RuleEngine._is_truthy_checkbox(value) == _as_bool(value)
