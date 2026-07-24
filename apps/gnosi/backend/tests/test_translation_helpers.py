"""Tests for the pure translation functions (`backend.services.translation_helpers`).

Run without Docker or the full backend:

    cd monorepo/apps/gnosi
    python3.11 -m pytest backend/tests/test_translation_helpers.py -q

(python3.11, not 3.9 — see `feedback_local_backend_test_verification`.)
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from backend.services.translation_helpers import (
    canonicalize_id,
    find_translations_of,
    translatable_content_changed,
    normalize_lang_code,
    detect_record_source_lang,
    find_language_property,
    language_field_value,
    language_field_assignment,
    is_image_field_name,
    is_composite_image_value,
    translate_image_field,
)


@dataclass
class FakePage:
    """Mimics the part of `PageInfo` that the helpers use."""

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
    """The origin saved without dashes must match the request with dashes."""
    origin_request = "df361486-5ff3-4a14-9005-5d9b7b456492"
    page = FakePage(
        "t",
        {"translation_origin_id": "df3614865ff34a1490055d9b7b456492", "translation_lang": "EN"},
    )
    found = find_translations_of(origin_request, [page])
    assert "en" in found  # language normalized to lowercase


def test_find_translations_ignores_entries_without_lang():
    origin = "x"
    pages = [FakePage("t", {"translation_origin_id": origin})]  # without translation_lang
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
    new = {"fld_desc": "Hola", "fld_color": "blue"}  # color is not translatable
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
# translatable_content_changed — pages
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
    # No body passed → body isn't compared; title equal → no change.
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
    assert normalize_lang_code("xx") == "xx"   # unknown 2-letter code → as-is
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


# --------------------------------------------------------------------------- #
# find_language_property
# --------------------------------------------------------------------------- #
def test_find_language_property_by_name_accent_insensitive():
    props = [
        {"name": "Títol", "type": "title", "id": "f1"},
        {"name": "Idioma", "type": "select", "id": "f2"},
    ]
    assert find_language_property(props)["id"] == "f2"
    assert find_language_property([{"name": "Llengua", "id": "f3"}])["id"] == "f3"
    assert find_language_property([{"name": "language", "id": "f4"}])["id"] == "f4"


def test_find_language_property_absent_returns_none():
    assert find_language_property([{"name": "Estat", "id": "f1"}]) is None
    assert find_language_property([]) is None
    assert find_language_property(None) is None


# --------------------------------------------------------------------------- #
# language_field_value
# --------------------------------------------------------------------------- #
def test_language_value_falls_back_to_uppercase_code():
    # Select with no option catalog (auto-generated) → uppercase code,
    # the format of the already-existing records ("Idioma: CA").
    prop = {"name": "Idioma", "type": "select", "id": "f2"}
    assert language_field_value(prop, "ca") == "CA"
    assert language_field_value(prop, "en") == "EN"
    assert language_field_value(prop, "Català") == "CA"  # accepts a label as input


def test_language_value_reuses_existing_catalog_option():
    # Notion style: if the catalog already has the option matching the code, reuse it
    # (doesn't duplicate "EN" next to "Anglès").
    prop = {"name": "Llengua", "type": "select", "id": "f2",
            "options": ["Català", "Castellà", "Anglès"]}
    assert language_field_value(prop, "ca") == "Català"
    assert language_field_value(prop, "en") == "Anglès"


def test_language_value_catalog_nested_in_config_with_dicts():
    prop = {"name": "language", "type": "select", "id": "f3",
            "config": {"options": [{"name": "EN"}, {"name": "FR"}]}}
    assert language_field_value(prop, "en") == "EN"


def test_language_value_blank_target_returns_blank():
    assert language_field_value({"name": "Idioma"}, "") == ""
    assert language_field_value({"name": "Idioma"}, "Klingon") == ""


# --------------------------------------------------------------------------- #
# language_field_assignment
# --------------------------------------------------------------------------- #
# Real case from the "Articles" table: Idioma is a select with no options and the original
# is saved with an uppercase code ("Idioma: ES"). The translation must end up marked
# with its own target language.
ARTICLES_PROPS = [
    {"name": "Títol", "type": "title", "id": "fld_f7f2aa14", "translatable": True},
    {"name": "Idioma", "type": "select", "id": "fld_31e396dc"},
    {"name": "Imatge Alt Text", "type": "text", "id": "fld_92aad08e", "translatable": True},
]


def test_assignment_real_articles_table():
    # Key = stable id (to_storage_names rewrites it to "Idioma" when saving); value = uppercase code.
    assert language_field_assignment(ARTICLES_PROPS, "ca", {"Idioma": "ES"}) == ("fld_31e396dc", "CA")
    assert language_field_assignment(ARTICLES_PROPS, "en", {"Idioma": "ES"}) == ("fld_31e396dc", "EN")


def test_assignment_no_language_field_is_noop():
    props = [{"name": "Títol", "type": "title", "id": "f1", "translatable": True}]
    assert language_field_assignment(props, "en", {}) == (None, None)


def test_assignment_blank_target_is_noop():
    assert language_field_assignment(ARTICLES_PROPS, "", {"Idioma": "ES"}) == (None, None)


def test_assignment_falls_back_to_name_when_no_id():
    assert language_field_assignment([{"name": "Idioma", "type": "select"}], "ca", {}) == ("Idioma", "CA")


def test_assignment_multi_select_wraps_in_list():
    assert language_field_assignment([{"name": "Idioma", "type": "multi_select", "id": "f4"}], "pt", {}) == ("f4", ["PT"])


def test_assignment_replicates_parent_list_format():
    # If the parent saved the language as a list, so does the translation (even though the
    # type is a simple select).
    props = [{"name": "Idioma", "type": "select", "id": "f5"}]
    assert language_field_assignment(props, "de", {"Idioma": ["ES"]}) == ("f5", ["DE"])


# --------------------------------------------------------------------------- #
# Composite image fields
# --------------------------------------------------------------------------- #
def test_is_image_field_name_accepts_image_excludes_text():
    assert is_image_field_name("Imatge") is True
    assert is_image_field_name("Cover") is True
    assert is_image_field_name("Foto portada") is True
    # Names that denote text ABOUT the image → they are not image fields:
    assert is_image_field_name("Imatge Alt Text") is False
    assert is_image_field_name("Caption") is False
    assert is_image_field_name("Peu de foto") is False
    assert is_image_field_name("Títol") is False


def test_is_composite_image_value():
    assert is_composite_image_value({"src": "Articles/x.png", "alt": "y"}) is True
    assert is_composite_image_value({"url": "http://x/y.png"}) is True
    assert is_composite_image_value({"alt": "y"}) is False   # without src/url/path
    assert is_composite_image_value("Articles/x.png") is False  # string path
    assert is_composite_image_value(None) is False


def test_translate_image_field_keeps_src_translates_text_subfields():
    val = {"src": "Articles/x.png", "alt": "hola", "title": "títol", "credit": "autor"}
    out, provs, any_tr = translate_image_field(val, lambda s: (s.upper(), "p"))
    assert out["src"] == "Articles/x.png"      # image intact (not duplicated)
    assert out["alt"] == "HOLA"
    assert out["title"] == "TÍTOL"
    assert out["credit"] == "AUTOR"
    assert any_tr is True
    assert provs == {"p"}


def test_translate_image_field_string_path_unchanged():
    # A string path is kept as-is: the path is not translated as if it were prose.
    out, provs, any_tr = translate_image_field("Articles/x.png", lambda s: (s.upper(), "p"))
    assert out == "Articles/x.png"
    assert any_tr is False
    assert provs == set()


def test_translate_image_field_noop_provider_not_collected():
    val = {"src": "x.png", "alt": "ja en destí"}
    out, provs, any_tr = translate_image_field(val, lambda s: (s, "noop"))
    assert out["alt"] == "ja en destí"
    assert any_tr is True           # the subfield has been processed...
    assert provs == set()           # ...but the "noop" provider is not counted
