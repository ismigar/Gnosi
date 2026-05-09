"""Unit tests for the Zotero mapping helpers in backend/api/zotero_routes.py.

These cover the pure functions that drive Phase 1 of the Zotero integration:
- `_norm` (label normalization)
- `_is_uuid`
- `build_recursos_schema` (localized schema builder)
- `default_mapping_for_table` (mapping for freshly created tables)
- `suggest_mapping_for_table` (heuristic auto-mapping for existing tables)
- `_migrate_legacy_mapping` (name → UUID migration)

We deliberately don't hit the FastAPI router here — that's covered by E2E tests
when the backend is running.

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_zotero_mapping.py -v
"""
from __future__ import annotations

import uuid

from backend.api.zotero_routes import (
    RECURSOS_LABELS,
    ZOTERO_FIELDS,
    _is_uuid,
    _migrate_legacy_mapping,
    _norm,
    build_recursos_schema,
    default_mapping_for_table,
    suggest_mapping_for_table,
)


# --- _norm ------------------------------------------------------------------


def test_norm_strips_diacritics():
    assert _norm("Títol") == "titol"
    assert _norm("Résumé") == "resume"


def test_norm_strips_symbols_and_lowers():
    assert _norm("Date Added") == "dateadded"
    assert _norm("zotero_key") == "zoterokey"


def test_norm_handles_empty():
    assert _norm("") == ""
    assert _norm(None) == ""  # type: ignore[arg-type]


# --- _is_uuid ---------------------------------------------------------------


def test_is_uuid_accepts_canonical_uuid():
    assert _is_uuid(str(uuid.uuid4()))


def test_is_uuid_rejects_plain_strings():
    assert not _is_uuid("title")
    assert not _is_uuid("")
    assert not _is_uuid(None)


# --- build_recursos_schema --------------------------------------------------


def test_build_recursos_schema_localized_ca():
    schema = build_recursos_schema("ca")
    names = [p["name"] for p in schema]
    assert "Títol" in names
    assert "Resum" in names
    assert "Etiquetes" in names


def test_build_recursos_schema_falls_back_to_english():
    schema = build_recursos_schema("xx")  # unknown lang
    names = [p["name"] for p in schema]
    assert "Title" in names
    assert "Abstract" in names


def test_build_recursos_schema_assigns_correct_types():
    schema = build_recursos_schema("en")
    types_by_name = {p["name"]: p["type"] for p in schema}
    assert types_by_name["Title"] == "title"
    assert types_by_name["Tags"] == "multi_select"
    assert types_by_name["Type"] == "select"
    assert types_by_name["Abstract"] == "rich_text"


# --- default_mapping_for_table ---------------------------------------------


def test_default_mapping_pairs_zotero_fields_to_localized_props():
    schema = build_recursos_schema("ca")
    props = [{"id": str(uuid.uuid4()), **p} for p in schema]
    mapping = default_mapping_for_table(props, "ca")

    # Every canonical Zotero field must resolve to a property id.
    for f in ZOTERO_FIELDS:
        assert f["id"] in mapping, f"Zotero field {f['id']} not mapped"
        assert _is_uuid(mapping[f["id"]])

    # The "title" Zotero field must point to the property labeled "Títol".
    title_pid = mapping["title"]
    title_prop = next(p for p in props if p["id"] == title_pid)
    assert title_prop["name"] == "Títol"


def test_default_mapping_for_english_lang():
    schema = build_recursos_schema("en")
    props = [{"id": str(uuid.uuid4()), **p} for p in schema]
    mapping = default_mapping_for_table(props, "en")

    title_pid = mapping["title"]
    title_prop = next(p for p in props if p["id"] == title_pid)
    assert title_prop["name"] == "Title"


# --- suggest_mapping_for_table ---------------------------------------------


def test_suggest_mapping_exact_normalized_match():
    # Properties named in mixed CA/ES; should match by normalized synonyms.
    props = [
        {"id": "p1", "name": "Title", "type": "title"},
        {"id": "p2", "name": "Autores", "type": "text"},
        {"id": "p3", "name": "Resumen", "type": "rich_text"},
        {"id": "p4", "name": "Tags", "type": "multi_select"},
    ]
    out = suggest_mapping_for_table(props)
    assert out["mapping"]["title"] == "p1"
    assert out["mapping"]["creators"] == "p2"
    assert out["mapping"]["abstractNote"] == "p3"
    assert out["mapping"]["tags"] == "p4"


def test_suggest_mapping_reports_unmapped():
    # Only `title` exists; everything else should be unmapped.
    props = [{"id": "p1", "name": "Title", "type": "title"}]
    out = suggest_mapping_for_table(props)
    assert out["mapping"]["title"] == "p1"
    assert "creators" in out["unmapped"]
    assert "tags" in out["unmapped"]


def test_suggest_mapping_flags_type_mismatch():
    # Title is mapped but typed as plain text instead of `title`.
    props = [{"id": "p1", "name": "Títol", "type": "text"}]
    out = suggest_mapping_for_table(props)
    assert out["mapping"]["title"] == "p1"
    assert any(c["zotero_field"] == "title" and c["expected_type"] == "title" for c in out["conflicts"])


def test_suggest_mapping_synonyms_cross_languages():
    # French + Catalan + English mix.
    props = [
        {"id": "p1", "name": "Titre", "type": "title"},
        {"id": "p2", "name": "Auteurs", "type": "text"},
        {"id": "p3", "name": "Etiquetes", "type": "multi_select"},
        {"id": "p4", "name": "Created", "type": "date"},
    ]
    out = suggest_mapping_for_table(props)
    assert out["mapping"]["title"] == "p1"
    assert out["mapping"]["creators"] == "p2"
    assert out["mapping"]["tags"] == "p3"
    assert out["mapping"]["dateAdded"] == "p4"


# --- _migrate_legacy_mapping -----------------------------------------------


def test_migrate_legacy_mapping_resolves_names_to_ids():
    table_id = str(uuid.uuid4())
    p1, p2 = str(uuid.uuid4()), str(uuid.uuid4())
    registry = {
        "tables": [
            {
                "id": table_id,
                "name": "Recursos",
                "properties": [
                    {"id": p1, "name": "title", "type": "title"},
                    {"id": p2, "name": "tipus_item", "type": "select"},
                ],
            }
        ]
    }
    config = {
        "target_table": table_id,
        "mapping": {"title": "title", "typeName": "tipus_item"},
    }
    out = _migrate_legacy_mapping(config, registry)
    assert out["mapping"]["title"] == p1
    assert out["mapping"]["typeName"] == p2


def test_migrate_legacy_mapping_idempotent_when_already_uuids():
    table_id = str(uuid.uuid4())
    p1 = str(uuid.uuid4())
    registry = {
        "tables": [
            {
                "id": table_id,
                "name": "Recursos",
                "properties": [{"id": p1, "name": "title", "type": "title"}],
            }
        ]
    }
    config = {"target_table": table_id, "mapping": {"title": p1}}
    out = _migrate_legacy_mapping(dict(config), registry)
    assert out["mapping"] == {"title": p1}


def test_migrate_legacy_mapping_drops_unresolved_entries():
    # Property "ghost" doesn't exist anywhere → mapping entry is dropped.
    table_id = str(uuid.uuid4())
    p1 = str(uuid.uuid4())
    registry = {
        "tables": [
            {
                "id": table_id,
                "name": "Recursos",
                "properties": [{"id": p1, "name": "title", "type": "title"}],
            }
        ]
    }
    config = {
        "target_table": table_id,
        "mapping": {"title": "title", "creators": "ghost"},
    }
    out = _migrate_legacy_mapping(config, registry)
    assert out["mapping"] == {"title": p1}


def test_migrate_legacy_mapping_no_target_table_returns_unchanged():
    config = {"mapping": {"title": "title"}}  # no target_table
    out = _migrate_legacy_mapping(dict(config), {"tables": []})
    assert out == config


# --- RECURSOS_LABELS sanity -------------------------------------------------


def test_all_languages_define_same_slugs():
    # Every locale must define the same set of slugs to avoid KeyError surprises.
    base = set(RECURSOS_LABELS["en"].keys())
    for lang, labels in RECURSOS_LABELS.items():
        assert set(labels.keys()) == base, f"Lang {lang} differs from en"
