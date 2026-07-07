"""Paritat d'ordenació de text amb accents entre el snapshot (backend) i la
vista principal (front, `compareFieldValues` amb `localeCompare('ca', base)`).

Abans, el fallback de cadena comparava per codepoint del `.lower()` cru, de
manera que qualsevol valor amb inicial accentuada (à = U+00E0) anava DESPRÉS de
la 'z' (U+007A). En un vault català/castellà, el snapshot ordenava diferent de
la vista principal. El fix plega els diacrítics a la lletra base.
"""
from backend.services.view_snapshot import _compare_field_values, multi_key_sort


# Ordre esperat = el que retorna `localeCompare('ca', {sensitivity:'base'})` al
# front (verificat en node): els accentuats s'interleaven per lletra base.
EXPECTED_CA = ["àrea", "Banana", "Çelona", "niu", "ópal", "Òrbita", "poma", "Zebra"]


def test_ordre_amb_accents_coincideix_amb_locale_del_front():
    words = ["Zebra", "àrea", "Banana", "Òrbita", "poma", "Çelona", "niu", "ópal"]
    rows = [{"metadata": {"Nom": w}} for w in words]
    out = multi_key_sort(rows, [{"field": "Nom", "direction": "asc"}])
    assert [r["metadata"]["Nom"] for r in out] == EXPECTED_CA


def test_accentuada_no_va_despres_de_la_z():
    # "àrea" < "Zebra" amb collation base (à→a); per codepoint seria al revés.
    assert _compare_field_values("àrea", "Zebra", "asc") < 0
    assert _compare_field_values("Zebra", "àrea", "asc") > 0


def test_base_insensible_a_accent_i_majuscula():
    # à == a == À (sensitivity base) → empat.
    assert _compare_field_values("àrea", "AREA", "asc") == 0
    assert _compare_field_values("Çelona", "celona", "asc") == 0


def test_descendent_mante_els_buits_al_final():
    # Els buits SEMPRE al final, també en descendent (no s'inverteixen).
    rows = [{"metadata": {"Nom": v}} for v in ["", "óptim", "", "abc"]]
    out = multi_key_sort(rows, [{"field": "Nom", "direction": "desc"}])
    noms = [r["metadata"]["Nom"] for r in out]
    assert noms[-2:] == ["", ""]           # buits al final
    assert noms[:2] == ["óptim", "abc"]    # desc: ó(base o) > a
