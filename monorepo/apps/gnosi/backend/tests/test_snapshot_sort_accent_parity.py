"""Sorting parity for accented text between the snapshot (backend) and the
main view (frontend, `compareFieldValues` with `localeCompare('ca', base)`).

Before, the string fallback compared by codepoint of the raw `.lower()`, so
any value with an accented initial (à = U+00E0) went AFTER
'z' (U+007A). In a Catalan/Castilian vault, the snapshot sorted differently from
the main view. The fix folds diacritics to the base letter.
"""
from backend.services.view_snapshot import _compare_field_values, multi_key_sort


# Expected order = whatever `localeCompare('ca', {sensitivity:'base'})` returns on the
# front (verified in node): accented characters interleave by base letter.
EXPECTED_CA = ["àrea", "Banana", "Çelona", "niu", "ópal", "Òrbita", "poma", "Zebra"]


def test_ordre_amb_accents_coincideix_amb_locale_del_front():
    words = ["Zebra", "àrea", "Banana", "Òrbita", "poma", "Çelona", "niu", "ópal"]
    rows = [{"metadata": {"Nom": w}} for w in words]
    out = multi_key_sort(rows, [{"field": "Nom", "direction": "asc"}])
    assert [r["metadata"]["Nom"] for r in out] == EXPECTED_CA


def test_accentuada_no_va_despres_de_la_z():
    # "àrea" < "Zebra" with base collation (à→a); by codepoint it would be reversed.
    assert _compare_field_values("àrea", "Zebra", "asc") < 0
    assert _compare_field_values("Zebra", "àrea", "asc") > 0


def test_base_insensible_a_accent_i_majuscula():
    # à == a == À (base sensitivity) → tie.
    assert _compare_field_values("àrea", "AREA", "asc") == 0
    assert _compare_field_values("Çelona", "celona", "asc") == 0


def test_buits_segueixen_la_direccio_desc_primer():
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
