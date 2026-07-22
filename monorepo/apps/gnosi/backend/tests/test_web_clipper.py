"""Web clipper mapping: which column receives what, and in which shape.

The clipper writes into a user-configured table, so the failure modes are silent
ones: a value landing on a column that no longer exists, a number persisted as
text (breaking sorting and formulas), or tags disappearing because the table has
no tags column. Each is asserted here — the module is pure, so no vault needed.
"""
import pytest

from backend.services import web_clipper as wc


def _table():
    return {
        "id": "resources",
        "name": "Recursos",
        "properties": [
            {"id": "fld_url", "name": "URL", "type": "url"},
            {"id": "fld_tags", "name": "Etiquetes", "type": "multi_select",
             "config": {"options": ["Llegit", "Pendent"]}},
            {"id": "fld_note", "name": "Resum", "type": "rich_text"},
            {"id": "fld_rating", "name": "Valoració", "type": "number"},
            {"id": "fld_state", "name": "Estat", "type": "select",
             "config": {"options": ["Esborrany", "Revisat"]}},
            {"id": "fld_done", "name": "Fet", "type": "checkbox"},
            {"id": "fld_calc", "name": "Calculat", "type": "formula"},
            {"id": "fld_rel", "name": "Relacionat", "type": "relation"},
        ],
    }


# --- role auto-detection -----------------------------------------------------

def test_roles_are_auto_detected_without_manual_mapping():
    mapping = wc.effective_mapping(_table(), {})
    assert mapping["url_property"]["id"] == "fld_url"
    assert mapping["tags_property"]["id"] == "fld_tags"
    assert mapping["content_property"]["id"] == "fld_note"


def test_explicit_mapping_beats_the_heuristic():
    table = _table()
    table["properties"].append({"id": "fld_link", "name": "Enllaç", "type": "text"})
    mapping = wc.effective_mapping(table, {"url_property": "fld_link"})
    assert mapping["url_property"]["id"] == "fld_link"


def test_no_mapping_sentinel_leaves_the_role_unfed():
    mapping = wc.effective_mapping(_table(), {"tags_property": wc.NO_MAPPING})
    assert mapping["tags_property"] is None


# --- the form the extension renders -----------------------------------------

def test_form_fields_only_returns_whitelisted_promptable_columns():
    cfg = {"fields": ["fld_rating", "fld_calc", "fld_rel", "fld_state"]}
    fields = wc.form_fields(_table(), cfg)
    assert [f["id"] for f in fields] == ["fld_rating", "fld_state"]
    assert fields[1]["options"] == ["Esborrany", "Revisat"]


def test_form_fields_skips_columns_already_fed_automatically():
    """Asking for the URL by hand when the URL column is auto-filled is noise."""
    fields = wc.form_fields(_table(), {"fields": ["fld_url", "fld_tags", "fld_rating"]})
    assert [f["id"] for f in fields] == ["fld_rating"]


def test_form_fields_is_empty_without_a_whitelist():
    assert wc.form_fields(_table(), {}) == []


# --- value coercion ----------------------------------------------------------

@pytest.mark.parametrize(
    "ptype, raw, expected",
    [
        ("multi_select", "a, b ,, c", ["a", "b", "c"]),
        ("multi_select", ["x", " y "], ["x", "y"]),
        ("checkbox", "true", True),
        ("checkbox", "", False),
        ("number", "4,5", 4.5),
        ("number", "3.0", 3),
        ("number", "no", None),
        ("text", "  hi  ", "hi"),
    ],
)
def test_coerce_value(ptype, raw, expected):
    assert wc.coerce_value({"type": ptype}, raw) == expected


# --- the record that gets written -------------------------------------------

def test_build_record_maps_url_tags_and_prompted_fields():
    metadata, body = wc.build_record(
        _table(), {},
        url="https://example.org/a",
        content="the selection",
        tags=["lectura"],
        fields={"fld_rating": "5", "fld_state": "Revisat"},
    )
    assert metadata["table_id"] == "resources"
    assert metadata["fld_url"] == "https://example.org/a"
    assert metadata["fld_tags"] == ["lectura"]
    assert metadata["fld_rating"] == 5
    assert metadata["fld_state"] == "Revisat"
    # The note went to the mapped column, so the body is not duplicated there.
    assert metadata["fld_note"] == "the selection"
    assert body == ""


def test_content_falls_back_to_the_page_body_with_the_source_link():
    table = _table()
    table["properties"] = [p for p in table["properties"] if p["id"] != "fld_note"]
    _metadata, body = wc.build_record(
        table, {}, url="https://example.org/a", content="text",
    )
    assert body.startswith("[Font](https://example.org/a)")
    assert "text" in body


def test_the_note_can_be_sent_to_the_page_body_instead_of_a_column():
    """«Cos de la pàgina» in the settings: the table has a note column, but the
    user wants the clip as prose under the source link, not a cell."""
    metadata, body = wc.build_record(
        _table(), {"content_property": wc.NO_MAPPING},
        url="https://example.org/a", content="the selection",
    )
    assert "fld_note" not in metadata
    assert body.startswith("[Font](https://example.org/a)")
    assert "the selection" in body


def test_tags_stay_in_the_frontmatter_when_there_is_no_tags_column():
    metadata, _body = wc.build_record(
        _table(), {"tags_property": wc.NO_MAPPING},
        url="https://example.org/a", tags=["lectura"],
    )
    assert metadata["tags"] == ["lectura"]
    assert "fld_tags" not in metadata


def test_values_for_unknown_or_computed_columns_are_dropped():
    """A stale extension form must not write orphan frontmatter keys."""
    metadata, _body = wc.build_record(
        _table(), {}, url="u",
        fields={"fld_gone": "x", "fld_calc": "y", "fld_rating": ""},
    )
    assert "fld_gone" not in metadata
    assert "fld_calc" not in metadata
    assert "fld_rating" not in metadata


def test_columns_can_be_addressed_by_name_and_alias():
    table = _table()
    table["properties"][4]["aliases"] = ["Status"]
    metadata, _body = wc.build_record(
        table, {}, url="u", fields={"Status": "Revisat", "Valoració": "2"},
    )
    assert metadata["fld_state"] == "Revisat"
    assert metadata["fld_rating"] == 2
