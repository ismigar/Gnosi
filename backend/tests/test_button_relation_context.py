"""Semantic relation choices use all indexed candidates and detect stale evidence."""

from copy import deepcopy
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from backend.services import button_relation_context as service


@pytest.fixture
def candidates(monkeypatch):
    rows = [{"id": str(i), "title": "Resource " + str(i), "metadata": {"topic": "physics"},
             "content": "Evidence", "content_truncated": False, "source_revision": str(i)} for i in range(125)]
    monkeypatch.setattr(service, "current_scope", lambda: SimpleNamespace(vault_path="/fixture"))
    monkeypatch.setattr(service, "revalidate_scope", lambda _scope: None)
    calls = []
    def load(field, **kwargs):
        assert kwargs == {"include_context": True}
        calls.append(field["relation_database_id"])
        return deepcopy(rows)
    monkeypatch.setattr(service, "relation_title_candidates", load)
    field = {"id": "r", "name": "Resource", "type": "relation", "relation_database_id": "resources"}
    return rows, calls, field


def test_context_includes_more_than_100_candidates_and_validates(candidates):
    rows, calls, field = candidates
    result = service.build_button_relation_context([field])
    assert len(result.candidates[0]["candidates"]) == 125
    assert result.candidates[0]["candidate_count"] == 125
    assert result.candidates[0]["candidates"][-1]["id"] == "124"
    result.validate()
    assert calls == ["resources", "resources"]


@pytest.mark.parametrize("change", ["source", "title", "metadata", "removed", "added"])
def test_candidate_changes_reject_the_selection(candidates, change):
    rows, _, field = candidates
    result = service.build_button_relation_context([field])
    if change == "source": rows[0]["source_revision"] = "edited outside the excerpt"
    elif change == "title": rows[0]["title"] = "changed"
    elif change == "metadata": rows[0]["metadata"]["topic"] = "medicine"
    elif change == "removed": rows.pop()
    elif change == "added": rows.append({"id": "new", "title": "New"})
    with pytest.raises(HTTPException) as error: result.validate()
    assert error.value.status_code == 409


def test_duplicate_destination_fields_read_once(candidates):
    _, calls, field = candidates
    second = {**field, "id": "r2", "name": "Other resource"}
    result = service.build_button_relation_context([field, second])
    assert calls == ["resources"] and len(result.candidates) == 2


def test_budget_failure_does_not_return_a_partial_candidate_list(candidates, monkeypatch):
    monkeypatch.setattr(service, "MAX_RELATION_CONTEXT_CHARS", 10)
    with pytest.raises(HTTPException) as error:
        service.build_button_relation_context([candidates[2]])
    assert error.value.status_code == 413


def test_scalar_fields_need_no_vault_reads(monkeypatch):
    monkeypatch.setattr(service, "current_scope", lambda: pytest.fail("Unexpected vault read"))
    result = service.build_button_relation_context([{"type": "number", "name": "Score"}])
    assert not result.candidates
    result.validate()


def test_semantic_evidence_after_the_initial_excerpt_is_preserved(candidates):
    rows, _, field = candidates
    rows[-1]["content"] = "Unrelated introduction. " * 100 + "Unique late evidence: post-quantum cryptography."
    result = service.build_button_relation_context([field])
    assert result.candidates[0]["complete_candidate_content"] is True
    assert "Unique late evidence" in result.candidates[0]["candidates"][-1]["content"]


def test_large_full_text_fails_before_partial_context_is_returned(candidates):
    rows, _, field = candidates
    rows[-1]["content"] = "x" * service.MAX_RELATION_CONTEXT_CHARS
    with pytest.raises(HTTPException) as error:
        service.build_button_relation_context([field])
    assert error.value.status_code == 413
