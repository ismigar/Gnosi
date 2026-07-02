"""`apply_filter` ha de tolerar el RENAME d'una columna.

Quan es renomena una columna, la metadata de `by-table` es canonicalitza al nom
NOU (`Àrees`) però els filtres guardats de les vistes poden portar encara una
variant ANTIGA del nom (amb un prefix decoratiu, espais o majúscules diferents).
El filtre ha de casar igualment resolent el field per nom NORMALITZAT
(`_normalize_field_key`: minúscules, sense prefix decoratiu inicial), o TOTES
les vistes per àrea surten buides.

Vegeu docs/dev_memory/directives/vault_relation_inverse_sync.md
"""
from __future__ import annotations

from backend.services.view_snapshot import (
    _meta_value_for_field,
    _normalize_field_key,
    apply_filter,
)

HOST = "1d2268e5-2714-8000-a413-c23a457bc7de"


def test_normalize_strips_decorative_prefix():
    assert _normalize_field_key("» Àrees") == _normalize_field_key("Àrees") == "àrees"
    assert _normalize_field_key("»· Extractes") == "extractes"
    assert _normalize_field_key("Arxivat") == "arxivat"


def test_meta_value_exact_key_wins():
    assert _meta_value_for_field({"» Àrees": [1]}, "» Àrees") == [1]


def test_meta_value_falls_back_to_normalized():
    # metadata canonicalitzada (nom net), filtre amb una variant antiga del nom
    assert _meta_value_for_field({"Àrees": ["x"]}, "» Àrees") == ["x"]
    # i a la inversa
    assert _meta_value_for_field({"» Àrees": ["x"]}, "Àrees") == ["x"]


def test_filter_matches_after_rename():
    """El cas real: una vista filtra per una variant antiga; metadata té `Àrees`."""
    meta = {"Àrees": [HOST, "other-area"]}
    f = {"field": "» Àrees", "operator": "equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is True
    assert apply_filter(meta, "absent", f) is False


def test_filter_still_works_without_rename():
    meta = {"Àrees": [HOST]}
    f = {"field": "Àrees", "operator": "equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is True


def test_filter_empty_when_no_inverse():
    meta = {"Àrees": ["other-area"]}
    f = {"field": "» Àrees", "operator": "equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is False


def test_not_equals_after_rename():
    meta = {"Àrees": ["other-area"]}
    f = {"field": "» Àrees", "operator": "not_equals", "value": "this"}
    assert apply_filter(meta, HOST, f) is True  # HOST no hi és → not_equals cert
