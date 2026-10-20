"""Native delivery and uploaded analysis inputs remain scoped and non-replaying."""
import base64
import hashlib

from fastapi import HTTPException
import pytest

from backend.domains.agent.routes.workspace_inputs import AnalysisImportRequest, import_input
from backend.services import agent_native_bridge as bridge
from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore


@pytest.fixture
def setup(tmp_path):
    return WorkbenchStore(tmp_path / 'workbench.sqlite'), WorkbenchScope('workspace', 'alice', '/synthetic-vault', 'agent', 'session')


def test_native_request_is_claimed_once_and_only_the_claim_can_complete(setup):
    store, scope = setup
    pending = bridge.enqueue(store, scope, 'request', {'action': 'browser-open', 'url': 'https://example.invalid'})
    assert pending['status'] == 'pending'
    claimed = bridge.claim(store, scope, 'request')
    with pytest.raises(HTTPException) as error:
        bridge.claim(store, scope, 'request')
    assert error.value.status_code == 409
    with pytest.raises(HTTPException):
        bridge.complete(store, scope, 'request', 'other-lease', {'status': 'opened'})
    result = bridge.complete(store, scope, 'request', claimed['lease'], {'status': 'opened'})
    assert result['status'] == 'completed'
    assert 'lease' not in result
    duplicate = bridge.enqueue(store, scope, 'request', {'action': 'browser-open', 'url': 'https://example.invalid'})
    assert duplicate['status'] == 'completed'
    with pytest.raises(HTTPException):
        bridge.enqueue(store, scope, 'request', {'action': 'app-type', 'text': 'different'})


def test_native_queue_cannot_cross_user_or_vault_and_uncertain_claim_does_not_repeat(setup, monkeypatch):
    store, scope = setup
    bridge.enqueue(store, scope, 'request', {'action': 'browser-snapshot'})
    bridge.claim(store, scope, 'request')
    other = WorkbenchScope('workspace', 'bob', scope.vault_path, 'agent', 'session')
    with pytest.raises(HTTPException) as error:
        bridge.claim(store, other, 'request')
    assert error.value.status_code == 404
    monkeypatch.setattr(bridge.time, 'time', lambda: 10 ** 12)
    assert bridge.requests(store, scope)[0]['status'] == 'unknown'
    with pytest.raises(HTTPException):
        bridge.claim(store, scope, 'request')


def test_analysis_import_is_checked_scoped_and_idempotent(setup):
    store, scope = setup
    data = b'name,value\nA,12\n'
    request = AnalysisImportRequest(agent_id=scope.agent_id, session_id=scope.session_id,
        name='dataset.csv', content_base64=base64.b64encode(data).decode(), size=len(data),
        sha256=hashlib.sha256(data).hexdigest(), request_id='imported-file')
    result = import_input(store, scope, request)
    assert result['status'] == 'imported'
    assert import_input(store, scope, request) == result
    artifact = store.path.parent / 'agent-workspace-artifacts' / scope.key / hashlib.sha256(b'imported-file').hexdigest() / 'dataset.csv'
    assert artifact.read_bytes() == data
    other = WorkbenchScope('workspace', 'bob', scope.vault_path, scope.agent_id, scope.session_id)
    with pytest.raises(HTTPException):
        store.get(other, 'analysis', request.request_id)
    for invalid in [request.model_copy(update={'sha256': '0' * 64}), request.model_copy(update={'name': '../escape'})]:
        with pytest.raises(HTTPException):
            import_input(store, scope, invalid)
