"""Button writes retain canonical rules, indices and completed related work."""
import asyncio
import json
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from backend.domains.vault.pages.patch_service import PatchPageDependencies
from backend.services import button_page_mutations as service


@pytest.fixture
def state(tmp_path, monkeypatch):
    path = tmp_path / "row.md"
    initial = {"id": "row", "table_id": "table", "count": 1, "untouched": False}
    path.write_text(json.dumps(initial) + "\nBody")
    original = path.read_text()
    events = []
    lock = asyncio.Lock()
    async def get_lock(_id): return lock
    async def prepare(_id): events.append("read")
    def find(*_args):
        raw = path.read_text(); metadata, body = raw.split("\n", 1)
        return path, json.loads(metadata), body, raw, None
    def rules(_id, old, new):
        events.append(("rules", old["count"], new["count"]))
        new["computed"] = new["count"] * 2
        return new
    def save(file, metadata, body):
        events.append("save"); file.write_text(json.dumps(metadata) + "\n" + body)
    ports = PatchPageDependencies(
        find_and_read=find, get_page_write_lock=get_lock, prepare_read=prepare,
        prepare_metadata=lambda metadata, _path: (metadata, None), relocate_file=lambda _id, file, _meta, _title: file,
        process_updates=rules, stamp_author=lambda *_args: events.append("author"), persist_assets=lambda value: value,
        ensure_citation_key=lambda value: value, dedupe_citation_key=lambda value, _id: value,
        save_page=save, update_caches=lambda *_args: events.append("cache"),
        create_content_version=lambda: lambda *_args: events.append("version"),
        create_file_version=lambda: lambda *_args: events.append("file_version"),
        update_link_index=lambda: lambda *_args: events.append("links"),
        rewrite_wikilinks=lambda: lambda *_args: 0, get_table_id=lambda metadata: metadata.get("table_id"),
        recompute_formulas=lambda: lambda *_args: events.append("formulas"),
        sync_calendar=lambda *_args: events.append("calendar"),
        propagate_translation=lambda: lambda *_args: events.append("translation"),
        propagate_relations=lambda: lambda *_args: events.append("relations"),
        resolve_page_context=lambda *_args: ("QA", "table"), file_etag=lambda _file: "etag",
        safe_error_detail=lambda _exc, _action: "failed", validate_patch=lambda *_args: events.append("existing_guard"),
    )
    monkeypatch.setattr(service, "current_scope", lambda: SimpleNamespace(user_id="u", vault_path=str(tmp_path)))
    def validate(file, raw, _fields, _assignments):
        assert lock.locked() and file == path and raw == original
        events.append("validate")
        return {}, "Body"
    monkeypatch.setattr(service, "prepare_button_assignments", validate)
    return SimpleNamespace(path=path, original=original, events=events, ports=ports)


def run(state, **kwargs):
    return asyncio.run(service.commit_button_mutation("row", state.path, state.original, [],
                      [{"field": "count", "value": 0}], dependencies=state.ports, **kwargs))


def test_button_uses_canonical_rules_and_finishes_all_side_effects(state):
    result = run(state)
    assert result["count"] == 0 and result["count_manual"] is True and result["computed"] == 0
    assert result["untouched"] is False and state.path.read_text().endswith("\nBody")
    assert state.events == ["read", "validate", "existing_guard", ("rules", 1, 0), "author", "save", "cache",
                            "calendar", "version", "links", "formulas", "translation", "relations"]


def test_resolved_values_are_applied_to_the_canonical_request(state, monkeypatch):
    monkeypatch.setattr(service, "prepare_button_assignments", lambda *_args: ({"count": 4}, "Body"))
    result = run(state)
    assert result["count"] == 4 and result["computed"] == 8
    assert result["count_manual"] is True and state.events.count("save") == 1


def test_changed_page_cannot_enter_rules_or_writer(state):
    state.path.write_text(state.original + "edited")
    with pytest.raises(HTTPException) as error: run(state)
    assert error.value.status_code == 409 and state.events == ["read"]
    assert state.path.read_text() == state.original + "edited"


def test_revoked_skill_cannot_write(state):
    def revoked(): raise PermissionError("revoked")
    with pytest.raises(PermissionError): run(state, guard=revoked)
    assert state.path.read_text() == state.original and state.events == ["read"]


def test_changed_semantic_candidates_stop_canonical_mutation_before_rules(state, monkeypatch):
    from copy import deepcopy
    from backend.services import button_relation_context
    rows = [{"id": "target", "title": "Resource", "source_revision": "before"}]
    monkeypatch.setattr(button_relation_context, "current_scope", lambda: SimpleNamespace(vault_path=str(state.path.parent)))
    monkeypatch.setattr(button_relation_context, "revalidate_scope", lambda _scope: None)
    monkeypatch.setattr(button_relation_context, "relation_title_candidates", lambda *_args, **_kwargs: deepcopy(rows))
    context = button_relation_context.build_button_relation_context([
        {"id": "links", "name": "Links", "type": "relation", "relation_database_id": "resources"}])
    rows[0]["source_revision"] = "external edit after generation"
    with pytest.raises(HTTPException) as error: run(state, guard=context.validate)
    assert error.value.status_code == 409
    assert state.path.read_text() == state.original and state.events == ["read"]


def test_two_actions_from_same_row_revision_cannot_both_write(state):
    async def execute():
        return await asyncio.gather(*[
            service.commit_button_mutation("row", state.path, state.original, [],
                [{"field": "count", "value": 0}], dependencies=state.ports) for _ in range(2)
        ], return_exceptions=True)
    results = asyncio.run(execute())
    assert sum(isinstance(result, dict) for result in results) == 1
    failures = [result for result in results if isinstance(result, HTTPException)]
    assert len(failures) == 1 and failures[0].status_code == 409 and state.events.count("save") == 1


def test_page_in_another_vault_cannot_enter_validation_or_writer(state, monkeypatch, tmp_path):
    monkeypatch.setattr(service, "current_scope", lambda: SimpleNamespace(user_id="u", vault_path=str(tmp_path / "other")))
    with pytest.raises(HTTPException) as error: run(state)
    assert error.value.status_code == 403 and state.path.read_text() == state.original
    assert state.events == ["read"]


def test_related_effect_failure_is_not_reported_as_success(state):
    from dataclasses import replace
    def failed(*_args): raise RuntimeError("relation effect failed")
    state.ports = replace(state.ports, propagate_relations=lambda: failed)
    with pytest.raises(RuntimeError, match="relation effect failed"): run(state)
    assert "save" in state.events and "translation" in state.events
