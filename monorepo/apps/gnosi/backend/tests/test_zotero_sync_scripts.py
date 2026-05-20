"""Unit tests for the standalone Zotero sync scripts.

The scripts live outside the `backend/` package (`pipeline/skills/zotero_sync/scripts`)
and run as standalone subprocesses. We add their dir to sys.path here so we can
import the pure helpers and test them in isolation, without touching SQLite or
the live API.

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_zotero_sync_scripts.py -v
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# pipeline/skills/zotero_sync/scripts is sibling of backend/; resolve absolutely.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = _BACKEND_DIR.parent / "pipeline" / "skills" / "zotero_sync" / "scripts"
sys.path.insert(0, str(_SCRIPTS_DIR))

import zotero_to_vault as ztv  # noqa: E402
import gnosi_to_zotero as gtz  # noqa: E402


# --- normalize_text ---------------------------------------------------------


def test_normalize_text_strips_diacritics_and_symbols():
    assert ztv.normalize_text("Què és això?") == "que es aixo"
    assert ztv.normalize_text("Hello, World!") == "hello world"


def test_normalize_text_handles_empty():
    assert ztv.normalize_text("") == ""
    assert ztv.normalize_text(None) == ""


# --- parse_zotero_ts --------------------------------------------------------


def test_parse_zotero_ts_canonical_format():
    dt = ztv.parse_zotero_ts("2026-05-09 12:34:56")
    assert dt is not None
    assert dt.year == 2026 and dt.month == 5 and dt.day == 9
    assert dt.tzinfo == timezone.utc


def test_parse_zotero_ts_handles_iso_with_z():
    dt = ztv.parse_zotero_ts("2026-05-09T12:34:56Z")
    assert dt is not None
    assert dt.hour == 12


def test_parse_zotero_ts_handles_date_only():
    dt = ztv.parse_zotero_ts("2026-05-09")
    assert dt is not None and dt.day == 9


def test_parse_zotero_ts_returns_none_on_garbage():
    assert ztv.parse_zotero_ts("nonsense") is None
    assert ztv.parse_zotero_ts("") is None
    assert ztv.parse_zotero_ts(None) is None


# --- index_pages ------------------------------------------------------------


def test_index_pages_builds_both_indexes():
    pages = [
        {"id": "p1", "title": "First", "metadata": {"zotero_key": "K1"}},
        {"id": "p2", "title": "Sécond — with diacritics!", "metadata": {}},
        {"id": "p3", "title": "Third", "metadata": {"zotero_key": "K3"}},
    ]
    by_key, by_title = ztv.index_pages(pages)
    assert by_key["K1"]["id"] == "p1"
    assert by_key["K3"]["id"] == "p3"
    # p2 has no zotero_key → only appears in by_title
    assert "K2" not in by_key
    assert by_title["second with diacritics"]["id"] == "p2"
    # All titled pages appear in by_title (including those with keys)
    assert by_title["first"]["id"] == "p1"


def test_index_pages_skips_empty_titles():
    pages = [
        {"id": "p1", "title": "", "metadata": {}},
        {"id": "p2", "title": None, "metadata": {}},
    ]
    by_key, by_title = ztv.index_pages(pages)
    assert by_key == {}
    assert by_title == {}


# --- page_id_for ------------------------------------------------------------


def test_page_id_for_prefers_top_level_id():
    page = {"id": "top", "metadata": {"id": "meta"}}
    assert ztv.page_id_for(page) == "top"


def test_page_id_for_falls_back_to_metadata():
    page = {"metadata": {"id": "meta"}}
    assert ztv.page_id_for(page) == "meta"


def test_page_id_for_handles_none():
    assert ztv.page_id_for(None) is None
    assert ztv.page_id_for({}) is None


# --- build_page_payload -----------------------------------------------------


def test_build_page_payload_uses_property_names():
    item = {"key": "K1", "title": "Hello", "creators": "Garcia, I.", "url": "https://x"}
    mapping = {"title": "p_title", "creators": "p_authors", "url": "p_url"}
    prop_meta = {
        "p_title": {"name": "Títol", "type": "title"},
        "p_authors": {"name": "Autors", "type": "text"},
        "p_url": {"name": "URL", "type": "url"},
    }
    payload = ztv.build_page_payload(item, mapping, "tbl", prop_meta)
    assert payload["title"] == "Hello"
    assert payload["metadata"]["Títol"] == "Hello"
    assert payload["metadata"]["Autors"] == "Garcia, I."
    assert payload["metadata"]["URL"] == "https://x"
    assert payload["metadata"]["database_table_id"] == "tbl"


def test_build_page_payload_skips_empty_and_orphan_props():
    item = {"key": "K1", "title": "T", "url": ""}  # url empty
    mapping = {"title": "p_title", "url": "p_url", "doi": "p_dead"}
    prop_meta = {"p_title": {"name": "Títol", "type": "title"}}  # p_url and p_dead missing
    payload = ztv.build_page_payload(item, mapping, "tbl", prop_meta)
    assert payload["metadata"].get("Títol") == "T"
    # No URL key created (empty value); no doi key either (orphan property id)
    assert "URL" not in payload["metadata"]
    assert "DOI" not in payload["metadata"]


def test_build_page_payload_falls_back_to_key_when_title_missing():
    item = {"key": "K42", "title": ""}
    payload = ztv.build_page_payload(item, {}, "tbl", {})
    assert payload["title"] == "K42"


def test_build_page_payload_writes_structured_authors_for_autoria_type():
    # Fase 4: amb el camp de creators de tipus `autoria`, s'escriu la forma
    # estructurada (firstName→nom, lastName→cognom1, cognom2 buit), no l'string.
    item = {
        "key": "K1",
        "title": "Simbiosi",
        "creators": "Lynn Margulis, Dorion Sagan",  # string (per a camps text)
        "creators_struct": [
            {"nom": "Lynn", "cognom1": "Margulis", "cognom2": ""},
            {"nom": "Dorion", "cognom1": "Sagan", "cognom2": ""},
        ],
    }
    mapping = {"title": "p_title", "creators": "p_authors"}
    prop_meta = {
        "p_title": {"name": "Títol", "type": "title"},
        "p_authors": {"name": "Autors", "type": "autoria"},
    }
    payload = ztv.build_page_payload(item, mapping, "tbl", prop_meta)
    assert payload["metadata"]["Autors"] == [
        {"nom": "Lynn", "cognom1": "Margulis", "cognom2": ""},
        {"nom": "Dorion", "cognom1": "Sagan", "cognom2": ""},
    ]


def test_build_page_payload_keeps_string_authors_for_text_type():
    # Compat enrere: si el camp segueix sent text, s'escriu l'string.
    item = {
        "key": "K2",
        "title": "X",
        "creators": "Garcia, I.",
        "creators_struct": [{"nom": "I.", "cognom1": "Garcia", "cognom2": ""}],
    }
    mapping = {"creators": "p_authors"}
    prop_meta = {"p_authors": {"name": "Autors", "type": "text"}}
    payload = ztv.build_page_payload(item, mapping, "tbl", prop_meta)
    assert payload["metadata"]["Autors"] == "Garcia, I."


def test_build_page_payload_autoria_empty_creators_skips_field():
    # Sense autors, no s'escriu el camp (ni string buit ni array buit).
    item = {"key": "K3", "title": "Y", "creators": "", "creators_struct": []}
    mapping = {"creators": "p_authors"}
    prop_meta = {"p_authors": {"name": "Autors", "type": "autoria"}}
    payload = ztv.build_page_payload(item, mapping, "tbl", prop_meta)
    assert "Autors" not in payload["metadata"]


# --- save_config_atomic -----------------------------------------------------


def test_save_config_atomic_writes_and_loads_back(tmp_path, monkeypatch):
    cfg_path = tmp_path / "zotero_db_config.json"
    monkeypatch.setattr(ztv, "CONFIG_PATH", cfg_path)
    data = {"enabled": True, "last_sync_at": "2026-05-09T12:00:00Z", "mapping": {"title": "abc"}}
    ztv.save_config_atomic(data)
    assert json.loads(cfg_path.read_text()) == data


def test_save_config_atomic_no_tmp_left_behind(tmp_path, monkeypatch):
    cfg_path = tmp_path / "zotero_db_config.json"
    monkeypatch.setattr(ztv, "CONFIG_PATH", cfg_path)
    ztv.save_config_atomic({"x": 1})
    leftovers = [p for p in tmp_path.iterdir() if p.name.startswith(".zotero_db_config.")]
    assert leftovers == []


# --- gnosi_to_zotero: writable_zfield_to_meta_key ---------------------------


def test_writable_zfield_skips_read_only_fields():
    # `dateAdded` and `dateModified` are read-only → excluded even if mapped.
    mapping = {
        "title": "p1",
        "url": "p2",
        "dateAdded": "p3",
        "dateModified": "p4",
        "key": "p5",
    }
    prop_names = {"p1": "Title", "p2": "URL", "p3": "Created", "p4": "Modified", "p5": "K"}
    out = gtz.writable_zfield_to_meta_key(mapping, prop_names)
    assert out == {"title": "Title", "url": "URL"}
    for forbidden in ("dateAdded", "dateModified", "key"):
        assert forbidden not in out


def test_writable_zfield_skips_non_updatable():
    # `creators` is not in UPDATABLE_FIELDS → excluded.
    mapping = {"title": "p1", "creators": "p2"}
    prop_names = {"p1": "Title", "p2": "Authors"}
    out = gtz.writable_zfield_to_meta_key(mapping, prop_names)
    assert "creators" not in out
    assert out["title"] == "Title"


def test_writable_zfield_skips_orphan_property_ids():
    # `p_dead` not in prop_names (column was deleted) → entry dropped.
    mapping = {"title": "p1", "url": "p_dead"}
    prop_names = {"p1": "Title"}
    out = gtz.writable_zfield_to_meta_key(mapping, prop_names)
    assert "url" not in out


def test_writable_zfield_handles_empty_inputs():
    assert gtz.writable_zfield_to_meta_key({}, {}) == {}
    assert gtz.writable_zfield_to_meta_key(None, {}) == {}


# --- gnosi_to_zotero constants sanity --------------------------------------


def test_read_only_includes_zotero_owned_fields():
    for f in ("dateAdded", "dateModified", "key", "tags", "creators", "typeName"):
        assert f in gtz.READ_ONLY_FIELDS


def test_updatable_fields_disjoint_from_read_only():
    assert set(gtz.UPDATABLE_FIELDS.keys()).isdisjoint(gtz.READ_ONLY_FIELDS)


# --- now_iso ----------------------------------------------------------------


def test_now_iso_format():
    s = ztv.now_iso()
    # Must roundtrip via parse_zotero_ts
    dt = ztv.parse_zotero_ts(s)
    assert dt is not None
    assert dt.tzinfo == timezone.utc
    # Exactly 'YYYY-MM-DDTHH:MM:SSZ'
    assert s.endswith("Z") and "T" in s and len(s) == 20
