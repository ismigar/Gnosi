"""An abruptly exited creator can expose a saved page without claiming success."""

import hashlib
import asyncio
import json
from pathlib import Path
import subprocess
import sys
import threading

from fastapi import FastAPI, HTTPException
import httpx
import pytest

from backend.domains.vault.pages.creation_requests import CreationRequests, creation_scope, get_creation_status
from backend.domains.vault.pages.creation_inputs import CreationInputs
from backend.services.context_vars import active_vault_path
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.tests.test_page_creation_responsiveness import dependencies


def parse(raw, _path):
    metadata, body = raw.split("\n\n", 1)
    return json.loads(metadata), body


@pytest.mark.parametrize("phase", ["before_write", "after_write"])
def test_process_exit_keeps_identity_and_recovers_only_verified_storage(tmp_path, phase):
    code = '''
import json, os, sys
from pathlib import Path
from fastapi import BackgroundTasks
from backend.domains.vault.pages.creation_requests import CreationRequests, _create_with_receipt
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.tests.test_page_creation_responsiveness import dependencies
root = Path(sys.argv[1]); phase = sys.argv[2]
def save(path, metadata, body):
    path.write_text(json.dumps(metadata) + "\\n\\n" + body)
def metadata(value):
    if phase == "before_write": os._exit(23)
    return value
def index(*_args):
    os._exit(23)
ports = dependencies(root, normalize_metadata=metadata, save_page=save, index_created_page=index)
_create_with_receipt(CreationRequests(root / "receipts.sqlite"), "scope", "key", root,
    PageSaveRequest(title="QA", content="Body", metadata={"zero": 0, "checked": False}), BackgroundTasks(), "user", ports)
'''
    child = subprocess.run([sys.executable, "-c", code, str(tmp_path), phase],
                           cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=20)
    assert child.returncode == 23, child.stderr.decode()
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    files = list(tmp_path.glob("*.md"))
    before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    indexed = {}
    ports = dependencies(tmp_path, parse_frontmatter=parse,
                         find_page_by_id=lambda page_id: indexed.get(page_id),
                         index_created_page=lambda page_id, path: indexed.update({page_id: path}))
    for _ in range(2):
        status = ledger.status("scope", "key", vault_path=tmp_path, dependencies=ports)
        assert status["status"] == "unknown" and status["result"] is None
        assert status["page_available"] is (phase == "after_write")
    assert {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in tmp_path.glob("*.md")} == before
    if files:
        metadata, body = parse(files[0].read_text(), files[0])
        assert metadata["id"] == status["page_id"] and metadata["checked"] is False and metadata["zero"] == 0 and body == "Body"
        assert indexed == {status["page_id"]: files[0]}
        inputs = CreationInputs(ledger._connect, "scope", "key")
        assert inputs.load_pending("links", tmp_path) == ((files[0],), {})
        relations, kwargs = inputs.load_pending("relations", tmp_path)
        assert relations == (status["page_id"], None, {}, metadata) and kwargs == {}
        assert inputs.load_pending("event_dispatch", tmp_path) == ((status["page_id"], "QA"), {})
        assert inputs.load_pending("page_cache", tmp_path) == ((), {})
        assert inputs.load_pending("sidebar_index", tmp_path) == ((files[0],), {})
        with pytest.raises(HTTPException) as uncertain:
            inputs.load_pending("index", tmp_path)
        assert uncertain.value.status_code == 409
        files[0].write_text(files[0].read_text() + "\nuser edit")
        with pytest.raises(HTTPException) as stale:
            inputs.load_pending("relations", tmp_path)
        assert stale.value.status_code == 409
    else:
        assert not indexed
    with pytest.raises(HTTPException) as error:
        ledger.claim("scope", "key", PageSaveRequest(title="QA", content="Body", metadata={"zero": 0, "checked": False}))
    assert error.value.status_code == 409


@pytest.mark.parametrize("case", ["missing", "different_id", "broken", "outside", "symlink"])
def test_unknown_receipt_cannot_expose_unverified_or_other_vault_file(tmp_path, case):
    vault = tmp_path / "vault"; vault.mkdir()
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    page_id, _ = ledger.claim("scope", "key", PageSaveRequest(title="QA", content=""))
    target = vault / "QA.md"
    if case == "different_id": target.write_text(json.dumps({"id": "other"}) + "\n\nBody")
    if case == "broken": target.write_text("incomplete")
    outside = tmp_path / "other.md"
    outside.write_text(json.dumps({"id": page_id}) + "\n\nPrivate")
    if case == "outside": target = outside
    if case == "symlink": target.symlink_to(outside)
    ledger.record_path("scope", "key", target); ledger.finish("scope", "key", None)
    seen = []
    registered = []
    def parser(raw, path):
        seen.append(path)
        return parse(raw, path)
    status = ledger.status("scope", "key", vault_path=vault, dependencies=dependencies(vault, parse_frontmatter=parser,
        index_created_page=lambda *_args: registered.append(True)))
    assert status["status"] == "unknown" and status["page_available"] is False and status["result"] is None
    if case in {"outside", "symlink"}: assert not seen
    assert not registered
    with pytest.raises(HTTPException) as error:
        ledger.status("other-scope", "key", vault_path=vault, dependencies=dependencies(vault))
    assert error.value.status_code == 404


def test_live_pending_operation_is_not_probed(tmp_path):
    ledger = CreationRequests(tmp_path / "receipts.sqlite")
    page_id, _ = ledger.claim("scope", "key", PageSaveRequest(title="QA", content=""))
    path = tmp_path / "QA.md"; path.write_text(json.dumps({"id": page_id}) + "\n\nBody")
    ledger.record_path("scope", "key", path)
    def parser(*_args):
        pytest.fail("An active writer must not be probed")
    result = ledger.status("scope", "key", vault_path=tmp_path, dependencies=dependencies(tmp_path, parse_frontmatter=parser))
    assert result["status"] == "pending" and result["page_available"] is False


def test_slow_cloud_recovery_probe_does_not_block_health(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    ledger = CreationRequests()
    scope = creation_scope("u", "w", tmp_path)
    page_id, _ = ledger.claim(scope, "key", PageSaveRequest(title="QA", content=""))
    path = tmp_path / "QA.md"; path.write_text(json.dumps({"id": page_id}) + "\n\nBody")
    ledger.record_path(scope, "key", path); ledger.finish(scope, "key", None)
    entered, release = threading.Event(), threading.Event()
    def parser(raw, path):
        assert active_vault_path.get() == tmp_path
        entered.set(); assert release.wait(3)
        return parse(raw, path)
    ports = dependencies(tmp_path, parse_frontmatter=parser)
    app = FastAPI()
    @app.get("/status")
    async def status():
        return await get_creation_status("u", "w", tmp_path, "key", ports)
    @app.get("/health")
    async def health():
        return {"ok": True}
    async def run():
        token = active_vault_path.set(tmp_path)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://qa") as client:
                pending = asyncio.create_task(client.get("/status"))
                try:
                    assert await asyncio.to_thread(entered.wait, 2)
                    assert (await asyncio.wait_for(client.get("/health"), 0.5)).status_code == 200
                    assert not pending.done()
                finally:
                    release.set()
                assert (await pending).json()["page_available"] is True
        finally:
            active_vault_path.reset(token)
    asyncio.run(run())
