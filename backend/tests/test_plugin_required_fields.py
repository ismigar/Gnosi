"""Required fields survive renames, locale changes, and legacy UUID schemas."""

from __future__ import annotations

from contextlib import nullcontext
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.domains.llm_wiki.brain_fields import role_value
from backend.domains.llm_wiki.field_catalogs import ensure_catalog
from backend.services.field_resolver import get_meta_value, set_meta_value, to_response_names
from backend.services.plugin_fields import bind, preserve_required_properties


def _field(role: str, name: str, field_type: str = "select") -> dict:
    prop = {"id": f"uuid-{role}", "name": name, "type": field_type}
    bind(prop, "llm-wiki", role)
    if role in {"idea_type", "verification"}:
        ensure_catalog(prop, role, "ca")
    return prop


@pytest.mark.parametrize("locale", ["ca", "en", "es", "fr"])
def test_localized_catalogs_and_renamed_fields_keep_their_roles(locale):
    from backend.api import vault_routes as facade
    from backend.domains.configuration.llm_wiki_schema import ensure_brain_table_schema
    from backend.domains.vault.knowledge import schema_service as schema

    table = {"id": "brain", "properties": []}
    reg = {"tables": [table]}
    saves = []
    deps = replace(
        schema._BRAIN_SCHEMA_DEPENDENCIES,
        registry_mutation=nullcontext,
        load_registry=lambda: reg,
        save_registry=lambda value: saves.append(deepcopy(value)),
    )
    assert ensure_brain_table_schema("brain", locale, {}, deps) == 8
    roles = schema._infer_brain_roles(table)
    for role, name, _ in facade._brain_schema(locale):
        prop = next(p for p in table["properties"] if p["name"] == name)
        if role in {"idea_type", "verification"}:
            assert len(prop["config"]["options"]) == 4
        if role not in {"areas", "tags"}:
            prop["aliases"].append(prop["name"])
            prop["name"] = "My custom " + role
    count = len(table["properties"])
    assert ensure_brain_table_schema("brain", "en", {}, deps) == 0
    assert len(table["properties"]) == count
    assert schema._infer_brain_roles(table) == roles
    saved_count = len(saves)
    assert ensure_brain_table_schema("brain", "en", {}, deps) == 0
    assert len(saves) == saved_count


def test_uuid_reference_and_alias_reads_do_not_depend_on_field_names():
    prop = _field("position", "Reading order", "number")
    prop["aliases"] = ["Position", "Posició"]
    table = {"properties": [prop]}
    meta = {"Position": 7}
    assert get_meta_value(meta, table, prop["id"]) == 7
    set_meta_value(meta, table, prop["id"], 9)
    assert to_response_names(meta, table)["Reading order"] == 9
    assert (
        role_value(
            {"Reading order": 9}, table, {"brain_roles": {"position": "obsolete-id"}}, "position"
        )
        == 9
    )


@pytest.mark.parametrize("change", ["delete", "replace_id", "change_type", "retarget"])
def test_required_property_replacements_fail_before_mutating_saved_schema(change):
    prop = _field("based_on", "Sources of this idea", "relation")
    prop["relation_database_id"] = "brain"
    old = {"properties": [prop]}
    new = deepcopy(old)
    if change == "delete":
        new["properties"] = []
    elif change == "replace_id":
        new["properties"][0]["id"] = "different"
    elif change == "change_type":
        new["properties"][0]["type"] = "text"
    else:
        new["properties"][0]["relation_database_id"] = "resources"
    with pytest.raises(HTTPException) as exc:
        preserve_required_properties(old, new)
    assert exc.value.status_code == 409
    assert old["properties"][0]["name"] == "Sources of this idea"


def test_full_schema_rename_cannot_strip_required_bindings_or_catalog_mapping():
    old = {"properties": [_field("verification", "Verification")]}
    new = deepcopy(old)
    new["properties"][0]["name"] = "Evidence review"
    new["properties"][0]["config"].pop("plugin_roles")
    new["properties"][0]["config"].pop("plugin_option_values")
    preserve_required_properties(old, new)
    assert new["properties"][0]["config"]["plugin_roles"] == {"llm-wiki": "verification"}
    assert new["properties"][0]["config"]["plugin_option_values"]["provisional"] == "Provisional"


def test_generated_notes_write_catalog_values_and_dates_after_arbitrary_renames(tmp_path):
    from backend.domains.llm_wiki import writing
    from backend.tests.test_llm_wiki_writing_open_metadata_contract import _dependencies

    props = [
        _field("idea_type", "Classification"),
        _field("verification", "Evidence"),
        _field("position", "Order", "number"),
        _field("last_reviewed", "Reviewed on", "date"),
    ]
    saved = []
    deps = replace(
        _dependencies(tmp_path),
        table_by_id=lambda _: {"properties": props},
        save_page_md=lambda path, metadata, body: saved.append(metadata),
    )
    writing.apply_plan(
        {"notes": [{"title": "Idea", "type": "síntesi", "managed_key": "key", "position": 3}]},
        "source",
        "Source",
        "brain",
        config={"brain_roles": {}},
        dependencies=deps,
    )
    assert saved[0]["Classification"] == "Síntesi"
    assert saved[0]["Evidence"] == "Provisional"
    assert saved[0]["Order"] == 3
    assert saved[0]["Reviewed on"] == "2026-01-01"
    assert "Tipus" not in saved[0] and "Última revisió" not in saved[0]


def test_lint_reads_review_id_after_rename_not_last_edit_date(monkeypatch):
    from backend.services import llm_wiki_config
    from backend.services import llm_wiki_lint as lint

    prop = _field("last_reviewed", "Evidence checked on", "date")
    prop["aliases"] = ["Last reviewed"]
    monkeypatch.setattr(lint.legacy_ports, "table_by_id", lambda _: {"properties": [prop]})
    monkeypatch.setattr(llm_wiki_config, "load_config", lambda: {"brain_roles": {}})
    page = SimpleNamespace(
        id="note",
        title="Note",
        path=None,
        metadata={
            "Last reviewed": "2026-09-01",
            "Última modificació": "2026-10-01",
            "note_type": "lectura",
        },
    )
    monkeypatch.setattr(lint.legacy_ports, "table_pages", lambda _: [page])
    assert lint._load_notes("brain")[0]["review"] == "2026-09-01"


def test_renaming_catalog_choice_preserves_writer_semantics():
    from backend.domains.llm_wiki.field_catalogs import catalog_value
    from backend.domains.vault.tables.catalogs.core import get_prop_options, set_prop_options
    from backend.domains.vault.tables.options import _rename_local_option

    prop = _field("verification", "Evidence")
    deps = SimpleNamespace(
        get_prop_options=get_prop_options,
        set_prop_options=set_prop_options,
        save_registry=lambda _: None,
    )
    _rename_local_option({}, {}, prop, prop["config"], "Provisional", "Pending evidence", deps)
    assert catalog_value(prop, "provisional") == "Pending evidence"
    preserve_required_properties({"properties": [prop]}, deepcopy({"properties": [prop]}))
    replacement = deepcopy(prop)
    replacement["config"]["options"] = []
    with pytest.raises(HTTPException) as exc:
        preserve_required_properties({"properties": [prop]}, {"properties": [replacement]})
    assert exc.value.detail["code"] == "plugin_required_option"


def test_source_processed_stamp_uses_id_after_rename(monkeypatch):
    from backend.api import vault_routes as facade
    from backend.domains.vault.knowledge import jobs_routes

    prop = _field("resource_processed", "Knowledge generated on", "date")
    monkeypatch.setattr(facade, "_table_by_id", lambda _: {"properties": [prop]})
    assert (
        jobs_routes._resource_processed_value({"table_id": "resources", prop["id"]: "2026-10-01"})
        == "2026-10-01"
    )


def test_renamed_source_relation_still_matches_context():
    from backend.services.llm_wiki import _fonts_ids

    prop = _field("source:resources", "Bibliographic origin", "relation")
    assert _fonts_ids({"Bibliographic origin": ["[[Book|page-id]]"]}, {"properties": [prop]}) == [
        "page-id"
    ]
