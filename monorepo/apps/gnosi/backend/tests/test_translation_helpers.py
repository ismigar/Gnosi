"""Tests de les funcions pures de traducció (`backend.services.translation_helpers`).

S'executen sense Docker ni el backend sencer:

    cd monorepo/apps/gnosi
    python3.11 -m pytest backend/tests/test_translation_helpers.py -q

(python3.11, no 3.9 — veure `feedback_local_backend_test_verification`.)
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from backend.services.translation_helpers import (
    canonicalize_id,
    find_translations_of,
    translatable_content_changed,
    normalize_lang_code,
    detect_record_source_lang,
)


@dataclass
class FakePage:
    """Imita la part de `PageInfo` que fan servir els helpers."""

    id: str
    metadata: Dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# canonicalize_id
# --------------------------------------------------------------------------- #
def test_canonicalize_id_strips_dashes_and_case():
    dashed = "DF361486-5FF3-4A14-9005-5D9B7B456492"
    plain = "df3614865ff34a1490055d9b7b456492"
    assert canonicalize_id(dashed) == canonicalize_id(plain)


def test_canonicalize_id_handles_none_and_blank():
    assert canonicalize_id(None) == ""
    assert canonicalize_id("   ") == ""


# --------------------------------------------------------------------------- #
# find_translations_of
# --------------------------------------------------------------------------- #
def test_find_translations_groups_by_lang():
    origin = "abc-123"
    pages = [
        FakePage("o", {"title": "Original"}),
        FakePage("t-en", {"translation_origin_id": origin, "translation_lang": "en"}),
        FakePage("t-es", {"translation_origin_id": origin, "translation_lang": "es"}),
        FakePage("other", {"translation_origin_id": "zzz", "translation_lang": "fr"}),
    ]
    found = find_translations_of(origin, pages)
    assert set(found.keys()) == {"en", "es"}
    assert found["en"].id == "t-en"
    assert found["es"].id == "t-es"


def test_find_translations_matches_across_id_forms():
    """L'origin desat sense guions ha de casar amb la petició amb guions."""
    origin_request = "df361486-5ff3-4a14-9005-5d9b7b456492"
    page = FakePage(
        "t",
        {"translation_origin_id": "df3614865ff34a1490055d9b7b456492", "translation_lang": "EN"},
    )
    found = find_translations_of(origin_request, [page])
    assert "en" in found  # idioma normalitzat a minúscules


def test_find_translations_ignores_entries_without_lang():
    origin = "x"
    pages = [FakePage("t", {"translation_origin_id": origin})]  # sense translation_lang
    assert find_translations_of(origin, pages) == {}


def test_find_translations_accepts_plain_dicts():
    origin = "x"
    pages = [{"id": "t", "metadata": {"translation_origin_id": origin, "translation_lang": "fr"}}]
    found = find_translations_of(origin, pages)
    assert found["fr"]["id"] == "t"


def test_find_translations_empty_origin_returns_empty():
    assert find_translations_of("", [FakePage("t", {"translation_lang": "en"})]) == {}


# --------------------------------------------------------------------------- #
# translatable_content_changed — registres
# --------------------------------------------------------------------------- #
def test_row_change_detected_on_translatable_field():
    keys = ["fld_desc"]
    old = {"fld_desc": "Hola"}
    new = {"fld_desc": "Hola món"}
    assert translatable_content_changed(keys, old, new) is True


def test_row_no_change_on_untracked_field():
    keys = ["fld_desc"]
    old = {"fld_desc": "Hola", "fld_color": "red"}
    new = {"fld_desc": "Hola", "fld_color": "blue"}  # color no és traduïble
    assert translatable_content_changed(keys, old, new) is False


def test_row_title_ignored_when_not_translatable():
    keys = ["fld_desc"]
    old = {"title": "A", "fld_desc": "x"}
    new = {"title": "B", "fld_desc": "x"}
    assert translatable_content_changed(keys, old, new, title_matters=False) is False


def test_row_title_counts_when_translatable():
    keys = ["fld_desc"]
    old = {"title": "A", "fld_desc": "x"}
    new = {"title": "B", "fld_desc": "x"}
    assert translatable_content_changed(keys, old, new, title_matters=True) is True


# --------------------------------------------------------------------------- #
# translatable_content_changed — pàgines
# --------------------------------------------------------------------------- #
def test_page_change_detected_on_body():
    assert translatable_content_changed(
        [], {"title": "T"}, {"title": "T"}, old_body="uno", new_body="dos", title_matters=True
    ) is True


def test_page_change_detected_on_title():
    assert translatable_content_changed(
        [], {"title": "A"}, {"title": "B"}, old_body="x", new_body="x", title_matters=True
    ) is True


def test_page_no_change_when_body_and_title_stable():
    assert translatable_content_changed(
        [], {"title": "A"}, {"title": "A"}, old_body="x", new_body="x", title_matters=True
    ) is False


def test_none_bodies_treated_as_empty_equal():
    # Cap body passat → no es compara cos; títol igual → sense canvi.
    assert translatable_content_changed([], {"title": "A"}, {"title": "A"}) is False


# --------------------------------------------------------------------------- #
# normalize_lang_code
# --------------------------------------------------------------------------- #
def test_normalize_lang_code_iso_and_labels():
    assert normalize_lang_code("ca") == "ca"
    assert normalize_lang_code("CA") == "ca"
    assert normalize_lang_code("Català") == "ca"
    assert normalize_lang_code("Castellà") == "es"
    assert normalize_lang_code("basc") == "eu"
    assert normalize_lang_code("gallego") == "gl"


def test_normalize_lang_code_regional_variants():
    assert normalize_lang_code("EN-GB") == "en"
    assert normalize_lang_code("pt_BR") == "pt"


def test_normalize_lang_code_unknown_and_blank():
    assert normalize_lang_code("") == ""
    assert normalize_lang_code(None) == ""
    assert normalize_lang_code("xx") == "xx"   # codi 2 lletres desconegut → tal qual
    assert normalize_lang_code("Klingon") == ""


# --------------------------------------------------------------------------- #
# detect_record_source_lang
# --------------------------------------------------------------------------- #
def test_detect_source_from_idioma_field():
    assert detect_record_source_lang({"Idioma": "ES"}) == "es"
    assert detect_record_source_lang({"Idioma": "CA"}) == "ca"
    assert detect_record_source_lang({"Idioma": "EN-GB"}) == "en"


def test_detect_source_field_name_accent_case_insensitive():
    assert detect_record_source_lang({"idioma": "Castellà"}) == "es"
    assert detect_record_source_lang({"Llengua": "basc"}) == "eu"
    assert detect_record_source_lang({"language": "zh"}) == "zh"


def test_detect_source_absent_or_empty_returns_blank():
    assert detect_record_source_lang({"Estat": "Publicat"}) == ""
    assert detect_record_source_lang({}) == ""
    assert detect_record_source_lang({"Idioma": ""}) == ""
    assert detect_record_source_lang(None) == ""
