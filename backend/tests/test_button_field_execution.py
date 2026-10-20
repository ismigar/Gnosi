"""Type, scope and concurrency boundaries for generated field values."""

from types import SimpleNamespace
import asyncio

from fastapi import HTTPException
from jsonschema import ValidationError
import pytest

from backend.services import button_field_execution as service
from backend.domains.vault.translation import routes
from backend.domains.vault.translation.request_contracts import ExecuteButtonActionRequest


@pytest.fixture
def state(monkeypatch, tmp_path):
    path = tmp_path / "row.md"
    path.write_text("original")
    registry = {"tables": [{"id": "table", "properties": [
        {"id": "count-id", "name": "count", "type": "number"},
        {"id": "flag-id", "name": "flag", "type": "checkbox"},
        {"id": "text-id", "name": "text", "type": "text"},
        {"id": "status-id", "name": "status", "type": "status", "config": {"catalog_ref": "status"}},
        {"id": "formula-id", "name": "computed", "type": "formula"},
    ]}], "option_catalogs": {"status": [{"name": "En revisió"}]}}
    monkeypatch.setattr(service, "load_registry", lambda: registry)
    monkeypatch.setattr(service, "current_scope", lambda: "scope")
    scopes, writes = [], []
    monkeypatch.setattr(service, "revalidate_scope", scopes.append)
    monkeypatch.setattr(service, "_write_page", lambda *args: writes.append(args))
    metadata = {"id": "row", "table_id": "table", "untouched": 0}
    monkeypatch.setattr(service, "_parse", lambda _path: (dict(metadata), "body"))
    return SimpleNamespace(path=path, registry=registry, scopes=scopes, writes=writes, metadata=metadata)


@pytest.mark.parametrize("reference,value", [("count-id", 0), ("flag", False), ("text", ""), ("status", "En revisió")])
def test_commit_preserves_json_types_and_untouched_metadata(state, reference, value):
    field, _schema = service.resolve_button_field(state.metadata, reference)
    result = service.commit_button_value(state.path, "original", state.metadata, "body", field, value)
    assert result[field["name"]] == value
    assert type(result[field["name"]]) is type(value)
    assert result["untouched"] == 0 and result[field["name"] + "_manual"] is True
    assert state.scopes == ["scope"] and len(state.writes) == 1


@pytest.mark.parametrize("reference,value", [("count", "0"), ("flag", 0), ("status", "Inventat"),
                                           ("count", float("nan")), ("count", float("inf"))])
def test_invalid_value_cannot_reach_the_writer(state, reference, value):
    field, _schema = service.resolve_button_field(state.metadata, reference)
    with pytest.raises(ValidationError):
        service.commit_button_value(state.path, "original", state.metadata, "body", field, value)
    assert state.writes == []


@pytest.mark.parametrize("change", ["row", "schema"])
def test_concurrent_change_rejects_stale_result(state, change):
    field, _schema = service.resolve_button_field(state.metadata, "count")
    if change == "row":
        state.path.write_text("new version")
    else:
        state.registry["tables"][0]["properties"][0]["name"] = "renamed"
    with pytest.raises(HTTPException) as error:
        service.commit_button_value(state.path, "original", state.metadata, "body", field, 12)
    assert error.value.status_code == 409 and state.writes == []


def test_revoked_scope_cannot_write(state, monkeypatch):
    field, _schema = service.resolve_button_field(state.metadata, "count")
    def revoked(_scope):
        raise PermissionError("revoked")
    monkeypatch.setattr(service, "revalidate_scope", revoked)
    with pytest.raises(PermissionError):
        service.commit_button_value(state.path, "original", state.metadata, "body", field, 12)
    assert state.writes == []


@pytest.mark.parametrize("reference", ["missing", "computed"])
def test_missing_and_computed_fields_are_rejected(state, reference):
    with pytest.raises(HTTPException):
        service.resolve_button_field(state.metadata, reference)


def test_non_table_page_cannot_acquire_arbitrary_properties(state):
    with pytest.raises(HTTPException) as error:
        service.resolve_button_field({"id": "page"}, "count")
    assert error.value.status_code == 422


def test_read_only_field_cannot_be_changed_even_with_a_scalar_type(state):
    state.registry["tables"][0]["properties"][0]["read_only"] = True
    with pytest.raises(HTTPException): service.resolve_button_field(state.metadata, "count")
    assert "count" not in [field["name"] for field in service.resolve_button_fields(state.metadata)]


def test_malformed_schema_during_generation_prevents_the_entire_batch(state):
    fields = service.resolve_button_fields(state.metadata)
    state.registry["tables"][0]["properties"][1]["type"] = {}
    with pytest.raises(HTTPException) as caught:
        service.commit_button_assignments(state.path, "original", fields, [
            {"field": "count", "value": 12}, {"field": "flag", "value": True},
        ])
    assert caught.value.status_code == 422
    assert state.writes == [] and state.path.read_text() == "original"


@pytest.fixture
def relation(state, monkeypatch):
    from backend.domains.vault.api import configuration_routes
    state.registry["tables"][0]["properties"].append({"id": "links-id", "name": "links", "type": "relation",
        "relation_database_id": "resources", "cardinality": "many-to-one"})
    target = state.path.parent / "resource.md"; target.write_text("resource")
    target_metadata = {"id": "resource-id", "table_id": "resources", "title": "Resource"}
    monkeypatch.setattr(service, "current_scope", lambda: SimpleNamespace(vault_path=str(state.path.parent)))
    def find(identifier, *, allow_full_scan):
        assert allow_full_scan is False
        return target if identifier == "resource-id" else None
    monkeypatch.setattr(configuration_routes, "find_page_path", find)
    monkeypatch.setattr(service, "_parse", lambda file: (dict(state.metadata), "body") if file == state.path else (dict(target_metadata), "resource body"))
    return state, target, target_metadata


@pytest.mark.parametrize("value", ["resource-id", ["resource-id"], "[[Resource|resource-id]]", [], "", None])
def test_relation_ids_wikilinks_and_clears_pass_without_altering_target(relation, value):
    state, target, _metadata = relation
    field, _schema = service.resolve_button_field(state.metadata, "links")
    result = service.commit_button_value(state.path, "original", state.metadata, "body", field, value)
    assert result["links"] == value and len(state.writes) == 1 and target.read_text() == "resource"


@pytest.fixture
def relation_titles(relation, monkeypatch):
    from backend.domains.vault.pages import foundation
    state, target, metadata = relation
    entries = [{"id": metadata["id"], "path": str(target), "metadata": dict(metadata), "folder": ""}]
    monkeypatch.setattr(service, "get_available_page_entries", lambda root: entries)
    monkeypatch.setattr(foundation, "_query_page_title", lambda meta, path: meta["title"])
    return state, target, metadata, entries


def test_relation_context_reads_full_content_and_full_source_revision(relation_titles, monkeypatch):
    import hashlib
    state, target, metadata, _entries = relation_titles
    original_parse = service._parse
    monkeypatch.setattr(service, "_parse", lambda path: (metadata, "x" * 1000) if path == target else original_parse(path))
    field, _ = service.resolve_button_field(state.metadata, "links")
    result = service.relation_title_candidates(field, include_context=True)
    assert result[0]["metadata"] == metadata
    assert result[0]["content"] == "x" * 1000 and result[0]["content_truncated"] is False
    assert result[0]["source_revision"] == hashlib.sha256(target.read_bytes()).hexdigest()


def test_relation_context_rejects_a_candidate_changed_while_reading(relation_titles, monkeypatch):
    state, target, metadata, _entries = relation_titles
    def changed(path):
        path.write_text("external edit")
        return metadata, "old body"
    monkeypatch.setattr(service, "_parse", changed)
    field, _ = service.resolve_button_field(state.metadata, "links")
    with pytest.raises(HTTPException) as error:
        service.relation_title_candidates(field, include_context=True)
    assert error.value.status_code == 409 and not state.writes


@pytest.mark.parametrize("value", ["Resource", " resource ", "[[Resource]]", ["Resource"]])
def test_unique_exact_relation_title_resolves_to_id(relation_titles, value):
    state, target, metadata, _entries = relation_titles
    field, _schema = service.resolve_button_field(state.metadata, "links")
    result = service.commit_button_value(state.path, "original", state.metadata, "body", field, value)
    assert result["links"] == ([metadata["id"]] if isinstance(value, list) else metadata["id"])
    assert target.read_text() == "resource" and len(state.writes) == 1


def test_duplicate_relation_titles_reject_every_assignment(relation_titles, monkeypatch):
    state, target, metadata, entries = relation_titles
    other = target.parent / "other.md"; other.write_text("untouched")
    duplicate = {**metadata, "id": "other-id"}
    entries.append({"id": "other-id", "path": str(other), "metadata": duplicate, "folder": ""})
    original_parse = service._parse
    monkeypatch.setattr(service, "_parse", lambda path: (duplicate, "Other body") if path == other else original_parse(path))
    fields = service.resolve_button_fields(state.metadata)
    with pytest.raises(HTTPException, match="ambiguous") as caught:
        service.commit_button_assignments(state.path, "original", fields, [
            {"field": "count", "value": 7}, {"field": "links", "value": "Resource"}])
    assert caught.value.status_code == 422 and not state.writes and other.read_text() == "untouched"


def test_shared_path_resolver_title_match_is_not_treated_as_an_identifier(relation_titles, monkeypatch):
    from backend.domains.vault.api import configuration_routes
    state, target, metadata, entries = relation_titles
    monkeypatch.setattr(configuration_routes, "find_page_path", lambda identifier, **kwargs: target)
    field, _schema = service.resolve_button_field(state.metadata, "links")
    result = service.commit_button_value(state.path, "original", state.metadata, "body", field, "Resource")
    assert result["links"] == metadata["id"]
    # Even a title resolver returning one arbitrary page cannot choose between
    # two pages whose current exact titles are equal.
    entries.append(dict(entries[0]))
    entries[-1]["id"] = "duplicate-id"
    other = target.parent / "duplicate.md"; other.write_text("unchanged")
    entries[-1]["path"] = str(other)
    original_parse = service._parse
    monkeypatch.setattr(service, "_parse", lambda path: ({**metadata, "id": "duplicate-id"}, "body") if path == other else original_parse(path))
    with pytest.raises(HTTPException, match="ambiguous"):
        service.commit_button_value(state.path, "original", state.metadata, "body", field, "Resource")
    assert len(state.writes) == 1


@pytest.mark.parametrize("case", ["stale_title", "wrong_table", "wrong_identity", "missing_index", "outside", "substring"])
def test_relation_title_resolution_fails_closed(relation_titles, monkeypatch, case):
    state, target, metadata, entries = relation_titles
    expected = 422
    value = "Resource"
    if case == "stale_title": metadata["title"] = "Renamed"
    elif case == "wrong_table": metadata["table_id"] = "other"; expected = 409
    elif case == "wrong_identity": metadata["id"] = "changed"; expected = 409
    elif case == "missing_index": monkeypatch.setattr(service, "get_available_page_entries", lambda root: None); expected = 503
    elif case == "outside": entries[0]["path"] = str(target.parent.parent / "outside.md"); expected = 403
    elif case == "substring": value = "Res"
    field, _schema = service.resolve_button_field(state.metadata, "links")
    with pytest.raises(HTTPException) as caught:
        service.commit_button_value(state.path, "original", state.metadata, "body", field, value)
    assert caught.value.status_code == expected and not state.writes


def test_relation_title_lookup_covers_more_than_one_hundred_rows(relation_titles, monkeypatch):
    state, target, metadata, entries = relation_titles
    pages = {}
    for number in range(121):
        path = target.parent / f"candidate-{number}.md"
        path.write_text("unchanged")
        row = {"id": f"candidate-{number}", "table_id": "resources", "title": f"Candidate {number}"}
        entries.insert(0, {"id": row["id"], "path": str(path), "metadata": row, "folder": ""})
        pages[path] = row
    original_parse = service._parse
    monkeypatch.setattr(service, "_parse", lambda path: (pages[path], "Body") if path in pages else original_parse(path))
    field, _schema = service.resolve_button_field(state.metadata, "links")
    result = service.commit_button_value(state.path, "original", state.metadata, "body", field, "Resource")
    assert result["links"] == metadata["id"] and len(state.writes) == 1
    assert all(path.read_text() == "unchanged" for path in pages)


@pytest.mark.parametrize("case", ["missing", "wrong_table", "wrong_identity", "duplicate_alias", "cardinality", "number"])
def test_invalid_relation_targets_reject_the_whole_batch(relation, case):
    state, target, metadata = relation
    value = ["resource-id"]
    if case == "missing": value = ["missing"]
    elif case == "wrong_table": metadata["table_id"] = "other"
    elif case == "wrong_identity": metadata["id"] = "other"
    elif case == "duplicate_alias":
        state.registry["tables"][0]["properties"][-1]["cardinality"] = "one-to-many"
        value = ["resource-id", "[[Resource|resource-id]]"]
    elif case == "cardinality": value = ["resource-id", "other"]
    elif case == "number": value = 0
    fields = service.resolve_button_fields(state.metadata)
    with pytest.raises((HTTPException, ValidationError)):
        service.commit_button_assignments(state.path, "original", fields, [{"field": "count", "value": 0}, {"field": "links", "value": value}])
    assert not state.writes and target.read_text() == "resource"


def test_relation_target_outside_scope_is_rejected_before_parse(relation, monkeypatch, tmp_path):
    state, _target, _metadata = relation
    monkeypatch.setattr(service, "current_scope", lambda: SimpleNamespace(vault_path=str(tmp_path / "other")))
    field, _schema = service.resolve_button_field(state.metadata, "links")
    with pytest.raises(HTTPException) as error:
        service.commit_button_value(state.path, "original", state.metadata, "body", field, ["resource-id"])
    assert error.value.status_code == 403 and not state.writes


def test_latest_sidecar_flags_are_preserved(state):
    field, _schema = service.resolve_button_field(state.metadata, "count")
    original_metadata = dict(state.metadata)
    state.metadata["text_manual"] = True
    result = service.commit_button_value(state.path, "original", original_metadata, "body", field, 12)
    assert result["text_manual"] is True


def test_skill_assignments_commit_once_and_preserve_false_zero_empty(state):
    fields = service.resolve_button_fields(state.metadata)
    result = service.commit_button_assignments(state.path, "original", fields, [
        {"field": "count", "value": 0}, {"field": "flag", "value": False}, {"field": "text", "value": ""}])
    assert result["count"] == 0 and type(result["count"]) is int
    assert result["flag"] is False and result["text"] == "" and result["untouched"] == 0
    assert len(state.writes) == 1 and state.writes[0][2] == "body"


@pytest.mark.parametrize("last", [{"field": "status", "value": "invented"},
                                 {"field": "computed", "value": 0}, {"field": "count", "value": 12}])
def test_invalid_later_assignment_never_persists_earlier_valid_values(state, last):
    fields = service.resolve_button_fields(state.metadata)
    with pytest.raises((HTTPException, ValidationError)):
        service.commit_button_assignments(state.path, "original", fields, [{"field": "count", "value": 0}, last])
    assert not state.writes and "count" not in state.metadata


@pytest.mark.parametrize("invalid", [False, True])
def test_set_fields_route_validates_whole_batch_before_one_commit(state, monkeypatch, invalid):
    from backend.services import button_page_mutations
    async def commit(_id, path, original, fields, assignments):
        return service.commit_button_assignments(path, original, fields, assignments)
    monkeypatch.setattr(button_page_mutations, "commit_button_mutation", commit)
    monkeypatch.setattr(routes._legacy, "find_page_path", lambda _id: state.path)
    monkeypatch.setattr(routes._legacy, "parse_frontmatter", lambda *_args: (dict(state.metadata), "body"))
    async def lock(_id): return asyncio.Lock()
    monkeypatch.setattr(routes._legacy, "_get_page_write_lock", lock)
    payload = ExecuteButtonActionRequest(note_id="row", button_action="set_fields", button_config={"assignments": [
        {"field": "count", "value": 0}, {"field": "flag", "value": "invalid" if invalid else False}]})
    if invalid:
        with pytest.raises(HTTPException) as error: asyncio.run(routes.execute_button_action(payload))
        assert error.value.status_code == 422 and not state.writes
    else:
        result = asyncio.run(routes.execute_button_action(payload))
        assert result["updated_fields"] == ["count", "flag"] and result["metadata"]["flag"] is False
        assert result["metadata"]["count"] == 0 and len(state.writes) == 1
