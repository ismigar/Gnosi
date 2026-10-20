"""Verified index state can settle a crash gap without repeating the effect."""

from dataclasses import replace
import json
from threading import Lock
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from backend.domains.vault.pages.creation_recovery import recover_creation
from backend.tests.test_page_creation_recovery_executor import state  # noqa: F401


@pytest.fixture
def uncertain(state):
    ledger, ports, calls, _request = state
    with ledger._connect() as db:
        db.execute("UPDATE creation_steps SET state='started' WHERE step='index'")
    def forbidden(*_args): raise AssertionError("Uncertain index callback was repeated")
    return ledger, replace(ports, index_created_page=forbidden), calls


def test_verified_index_reconciles_without_callback_and_records_proof(uncertain, tmp_path):
    ledger, ports, calls = uncertain
    before = (tmp_path / "QA.md").read_bytes()
    seen = []
    def verify(page_id, path):
        seen.append((page_id, path)); return True
    result = recover_creation(ledger, "scope", "key", tmp_path, replace(ports, verify_index_created=verify), guard=lambda: None)
    assert "index" not in calls and calls == ["cache", "sidebar", "event", "links", "planning", "relations"]
    assert seen == [(result["id"], tmp_path / "QA.md")]
    assert (tmp_path / "QA.md").read_bytes() == before
    with ledger._connect() as db:
        proof = json.loads(db.execute("SELECT proof FROM creation_reconciliations").fetchone()[0])
    assert proof["kind"] == "page-index-v1" and proof["page_id"] == result["id"]
    assert proof["path"] == str(tmp_path / "QA.md") and len(proof["source_revision"]) == 64
    assert recover_creation(ledger, "scope", "key", tmp_path, ports, guard=lambda: None) == result


@pytest.mark.parametrize("case", ["missing_verifier", "false", "truthy", "source", "other_uncertain", "bad_inputs", "config"])
def test_unverified_index_cannot_change_any_checkpoint_or_run_callbacks(uncertain, tmp_path, case):
    ledger, ports, calls = uncertain
    verifier = lambda *_args: True
    if case == "missing_verifier": verifier = None
    elif case == "false": verifier = lambda *_args: False
    elif case == "truthy": verifier = lambda *_args: 1
    elif case == "source": (tmp_path / "QA.md").write_text("user edit")
    elif case == "config":
        (tmp_path / ".gnosi").mkdir(); (tmp_path / ".gnosi/params.yaml").write_text("changed: true")
    with ledger._connect() as db:
        if case == "other_uncertain": db.execute("UPDATE creation_steps SET state='started' WHERE step='links'")
        elif case == "bad_inputs": db.execute("UPDATE creation_step_inputs SET payload='[]' WHERE step='index'")
    with pytest.raises(HTTPException):
        recover_creation(ledger, "scope", "key", tmp_path, replace(ports, verify_index_created=verifier), guard=lambda: None)
    assert calls == []
    with ledger._connect() as db:
        assert db.execute("SELECT state FROM creation_steps WHERE step='index'").fetchone()[0] == "started"
        assert db.execute("SELECT COUNT(*) FROM creation_reconciliations").fetchone()[0] == 0


def test_changed_page_during_verification_cannot_be_reconciled(uncertain, tmp_path):
    ledger, ports, calls = uncertain
    def verify(*_args):
        path = tmp_path / "QA.md"; path.write_text(path.read_text() + "\nedit")
        return True
    with pytest.raises(HTTPException):
        recover_creation(ledger, "scope", "key", tmp_path, replace(ports, verify_index_created=verify), guard=lambda: None)
    assert calls == []
    with ledger._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM creation_reconciliations").fetchone()[0] == 0


@pytest.mark.parametrize("verified", [True, False, 1])
def test_status_offers_resume_only_with_strict_index_proof(uncertain, tmp_path, verified):
    ledger, ports, calls = uncertain
    ports = replace(ports, find_page_by_id=lambda _id: tmp_path / "QA.md",
                    index_created_page=lambda *_args: None,
                    verify_index_created=lambda *_args: verified)
    status = ledger.status("scope", "key", vault_path=tmp_path, dependencies=ports)
    assert status["page_available"] is True
    assert status["can_resume"] is (verified is True)
    assert {item["step"]: item["state"] for item in status["steps"]}["index"] == "uncertain"
    assert not calls
    with ledger._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM creation_reconciliations").fetchone()[0] == 0


@pytest.mark.parametrize("case", ["valid", "entry", "mapping", "resolver", "files", "identity", "outside"])
def test_canonical_index_verifier_checks_every_postcondition_without_discovery(tmp_path, monkeypatch, case):
    from backend.domains.vault.api import core_routes
    path = tmp_path / "Page.md"; path.write_text("Body")
    expected = {"id": "page", "path": str(path), "title": "Page"}
    entries = {str(path): dict(expected)}
    mapping = {"page": str(path)}
    resolved = path
    files = [path]
    if case == "entry": entries[str(path)]["title"] = "stale"
    elif case == "mapping": mapping.clear()
    elif case == "resolver": resolved = None
    elif case == "files": files = []
    elif case == "identity": expected["id"] = "other"; entries[str(path)] = dict(expected)
    elif case == "outside": path = tmp_path.parent / "private.md"
    resolver = SimpleNamespace(find_path=lambda *_args: resolved, _vault_files={str(tmp_path): files})
    port = SimpleNamespace(get_active_vault_path=lambda: tmp_path,
        _build_page_cache_entry=lambda *_args: expected, _canonicalize_id=str,
        _page_index_lock=Lock(), _page_index_entries={str(tmp_path): entries},
        _page_id_to_path={str(tmp_path): mapping}, path_resolver=resolver)
    monkeypatch.setattr(core_routes, "_vault", port)
    def forbidden(*_args): raise AssertionError("Whole-vault discovery was attempted")
    monkeypatch.setattr(type(tmp_path), "rglob", forbidden)
    assert core_routes._verify_created_page_index("page", path) is (case == "valid")
