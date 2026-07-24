"""Sorting parity for accented text between the snapshot and the main view.

The frontend uses English base-sensitive collation. Before, the backend string
fallback compared raw lowercase codepoints, placing accented initials after z.
The fix folds diacritics to the base letter.
"""
from backend.services.view_snapshot import _compare_field_values, multi_key_sort


# Expected English base-collation order, verified in Node.
EXPECTED_EN = ["àrea", "Banana", "Çelona", "niu", "ópal", "Òrbita", "poma", "Zebra"]


def test_accented_order_matches_frontend_locale():
    words = ["Zebra", "àrea", "Banana", "Òrbita", "poma", "Çelona", "niu", "ópal"]
    rows = [{"metadata": {"Nom": w}} for w in words]
    out = multi_key_sort(rows, [{"field": "Nom", "direction": "asc"}])
    assert [r["metadata"]["Nom"] for r in out] == EXPECTED_EN


def test_accented_value_does_not_sort_after_z():
    # "àrea" < "Zebra" with base collation (à→a); by codepoint it would be reversed.
    assert _compare_field_values("àrea", "Zebra", "asc") < 0
    assert _compare_field_values("Zebra", "àrea", "asc") > 0


def test_base_collation_ignores_accent_and_case():
    # à == a == À (base sensitivity) → tie.
    assert _compare_field_values("àrea", "AREA", "asc") == 0
    assert _compare_field_values("Çelona", "celona", "asc") == 0


def test_empty_values_follow_direction_with_descending_first():
    # Empty values FOLLOW the direction: FIRST in desc, LAST in asc
    # (Excel/Sheets convention).
    rows = [{"metadata": {"Nom": v}} for v in ["", "óptim", "", "abc"]]
    out = multi_key_sort(rows, [{"field": "Nom", "direction": "desc"}])
    noms = [r["metadata"]["Nom"] for r in out]
    assert noms[:2] == ["", ""]            # empty ones first in desc
    assert noms[-2:] == ["óptim", "abc"]   # desc: ó (base o) > a


def test_buits_segueixen_la_direccio_asc_ultim():
    # Empty values FOLLOW the direction: LAST in asc.
    rows = [{"metadata": {"Nom": v}} for v in ["", "óptim", "", "abc"]]
    out = multi_key_sort(rows, [{"field": "Nom", "direction": "asc"}])
    noms = [r["metadata"]["Nom"] for r in out]
    assert noms[:2] == ["abc", "óptim"]    # asc: a < ó (base o)
    assert noms[-2:] == ["", ""]           # empty ones last in asc
