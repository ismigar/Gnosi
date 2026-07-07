"""`percent_checked` ha de dividir per TOTS els relacionats (paritat amb
Notion i amb el càlcul en viu del frontend), no només pels que tenen la
casella amb valor.

Frontend (`rollupUtils.evaluateRollup`): `checked / values.length`, on
`values` té una entrada per registre relacionat (les caselles buides hi
són com a `undefined`). El backend dividia per `len(non_empty)`, excloent
les buides → percentatge inflat i divergent del que es veu en viu.
"""
from backend.services.rule_engine import RuleEngine


def _engine_with_values(related_rows, values):
    # Bypass __init__ (no cal vault): _evaluate_rollup_definition només fa
    # servir _collect_rollup_values (que substituïm) i el staticmethod
    # _is_truthy_checkbox.
    engine = RuleEngine.__new__(RuleEngine)
    engine._collect_rollup_values = lambda definition, meta: (related_rows, values)
    return engine


def _pct(values):
    related_rows = [{} for _ in values]
    engine = _engine_with_values(related_rows, values)
    return engine._evaluate_rollup_definition({"aggregation": "percent_checked"}, {})


def _frontend_pct(values):
    """Rèplica de la lògica del frontend per comparar paritat."""
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
    # 2 marcades, 1 desmarcada, 1 buida → 2/4 = 50% (no 2/3 = 66,67%)
    assert _pct([True, True, False, None]) == 50.0


def test_totes_marcades():
    assert _pct([True, True, "sí"]) == 100.0


def test_cap_marcada():
    assert _pct([False, None, ""]) == 0.0


def test_sense_relacionats_retorna_zero():
    assert _pct([]) == 0


def test_paritat_amb_el_frontend():
    # El backend manté 2 decimals (valor numèric persistit) i el frontend
    # arrodoneix a enter per mostrar-lo (formatació); comparem el rati
    # arrodonit a enter per validar la paritat de denominador+numerador
    # sense lligar-nos a la precisió decimal (que és per disseny).
    for vals in (
        [True, True, False, None],
        [True, None, None, None],
        ["sí", "no", "", "done"],
        [1, 0, None],
    ):
        assert round(float(_pct(vals))) == _frontend_pct(vals), vals
