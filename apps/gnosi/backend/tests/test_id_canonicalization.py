"""Tests for the ID/table_id helpers in backend/api/vault_routes.py.

These were added to fix the 'page not found' bug when frontmatter ids and
URL ids disagreed on dash style (Notion exports 32-hex no-dash, Gnosi/UUID
spec uses dashes). Also covers the table_id alias resolution (table_id vs
database_table_id).
"""
from __future__ import annotations

from backend.api.vault_routes import _canonicalize_id, get_table_id


# --- _canonicalize_id -------------------------------------------------------

def test_canonicalize_drops_dashes():
    dashed = "df361486-5ff3-4a14-9005-5d9b7b456492"
    bare = "df3614865ff34a1490055d9b7b456492"
    assert _canonicalize_id(dashed) == _canonicalize_id(bare) == bare


def test_canonicalize_is_case_insensitive():
    upper = "DF361486-5FF3-4A14-9005-5D9B7B456492"
    lower = "df361486-5ff3-4a14-9005-5d9b7b456492"
    assert _canonicalize_id(upper) == _canonicalize_id(lower)


def test_canonicalize_handles_none_and_empty():
    assert _canonicalize_id(None) == ""
    assert _canonicalize_id("") == ""
    assert _canonicalize_id("   ") == ""


def test_canonicalize_strips_whitespace():
    assert _canonicalize_id("  df3614865ff34a1490055d9b7b456492  ") \
        == "df3614865ff34a1490055d9b7b456492"


# --- get_table_id -----------------------------------------------------------

def test_get_table_id_prefers_database_table_id():
    meta = {"database_table_id": "new", "table_id": "legacy"}
    assert get_table_id(meta) == "new"


def test_get_table_id_falls_back_to_table_id():
    meta = {"table_id": "legacy"}
    assert get_table_id(meta) == "legacy"


def test_get_table_id_returns_none_when_neither_present():
    assert get_table_id({}) is None
    assert get_table_id(None) is None


def test_get_table_id_ignores_empty_string():
    # `""` is falsy → should fall back / return None
    meta = {"database_table_id": "", "table_id": "legacy"}
    assert get_table_id(meta) == "legacy"
    assert get_table_id({"database_table_id": "", "table_id": ""}) is None


def test_get_table_id_returns_string_even_for_uuid_object():
    """If the registry stores UUID objects (rare but possible), coerce to str."""
    import uuid
    meta = {"database_table_id": uuid.UUID("12345678-1234-1234-1234-123456789012")}
    out = get_table_id(meta)
    assert isinstance(out, str)
