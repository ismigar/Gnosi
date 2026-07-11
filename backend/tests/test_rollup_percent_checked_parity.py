"""`percent_checked` must divide by ALL related records (parity with
Notion and with the frontend's live calculation), not just the ones whose
checkbox has a value.

Frontend (`rollupUtils.evaluateRollup`): `checked / values.length`, where
`values` has one entry per related record (empty checkboxes appear
as `undefined`). The backend divided by `len(non_empty)`, excluding
the empty ones → an inflated percentage that diverges from what's shown live.
"""
from backend.services.rule_engine import RuleEngine


def _engine_with_values(related_rows, values):
    # Bypass __init__ (no vault needed): _evaluate_rollup_definition only does
    # use _collect_rollup_values (which we replace) and the staticmethod
    # _is_truthy_checkbox.
    engine = RuleEngine.__new__(RuleEngine)
    engine._collect_rollup_values = lambda definition, meta: (related_rows, values)
    return engine


def _pct(values):
    related_rows = [{} for _ in values]
    engine = _engine_with_values(related_rows, values)
    return engine._evaluate_rollup_definition({"aggregation": "percent_checked"}, {})


def _frontend_pct(values):
    """Replica of the frontend logic to compare parity."""
    truthy = {"true", "1", "yes", "si", "sí", "done", "checked", "completat"}

    def as_bool(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return v != 0
        return str(v or "").strip().lower() in truthy

    if not values:
        return 0
    checked = sum(1 for v in values if as_bool(v))
    return round((checked / len(values)) * 100)


def test_mix_marcades_i_buides_divideix_pel_total():
    # 2 checked, 1 unchecked, 1 empty → 2/4 = 50% (not 2/3 = 66.67%)
    assert _pct([True, True, False, None]) == 50.0


def test_totes_marcades():
    assert _pct([True, True, "sí"]) == 100.0


def test_cap_marcada():
    assert _pct([False, None, ""]) == 0.0


def test_sense_relacionats_retorna_zero():
    assert _pct([]) == 0


def test_paritat_amb_el_frontend():
    # The backend keeps 2 decimals (persisted numeric value) and the frontend
    # rounds to an integer to display it (formatting); we compare the ratio
    # rounded to an integer to validate the parity of denominator+numerator
    # without tying ourselves to the decimal precision (which is by design).
    for vals in (
        [True, True, False, None],
        [True, None, None, None],
        ["sí", "no", "", "done"],
        [1, 0, None],
    ):
        assert round(float(_pct(vals))) == _frontend_pct(vals), vals
