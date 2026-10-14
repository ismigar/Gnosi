"""Workbench tests use synthetic directories and local receipts only."""
import asyncio
import base64
from dataclasses import replace
import os
import subprocess
import sys
import hashlib
import hmac
import json
from pathlib import Path
import time

from fastapi import HTTPException
import pytest

from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore
from backend.services import agent_workspace_files as files
from backend.services import agent_workspace_analysis as analysis

pytestmark = pytest.mark.usefixtures('isolated_validation_runtime')


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('GNOSI_DESKTOP_SELECTION_SECRET', 'synthetic-test-secret')
    scope = WorkbenchScope('workspace', 'user', str(tmp_path / 'vault'), 'agent', 'session')
    store = WorkbenchStore(tmp_path / 'state.sqlite')
    root = tmp_path / 'external'
    root.mkdir()
    return store, scope, root


def token(scope, root, nonce='test-nonce-1234'):
    payload = base64.urlsafe_b64encode(json.dumps(dict(scope_key=scope.key, path=str(root), agent_id=scope.agent_id, session_id=scope.session_id, expires_at=time.time()+60, nonce=nonce)).encode()).decode().rstrip('=')
    return payload + '.' + hmac.new(b'synthetic-test-secret', payload.encode(), hashlib.sha256).hexdigest()


def test_native_grant_rejects_forgery_and_replay(setup):
    store, scope, root = setup
    with pytest.raises(HTTPException) as error:
        files.grant_folder(store, scope, str(root), 'fake.token')
    assert error.value.status_code == 403
    grant = files.grant_folder(store, scope, str(root), token(scope, root))
    assert grant['path'] == str(root)
    with pytest.raises(HTTPException) as error:
        files.grant_folder(store, scope, str(root), token(scope, root))
    assert error.value.status_code == 409


def test_scoped_transfer_integrity_idempotency_and_revocation(setup):
    store, scope, root = setup
    grant = files.grant_folder(store, scope, str(root), token(scope, root))
    data = b'test content'
    sha = hashlib.sha256(data).hexdigest()
    with pytest.raises(HTTPException):
        files.transfer(store, scope, grant['id'], 'report.txt', data, len(data)+1, sha, 'bad-size')
    receipt = files.transfer(store, scope, grant['id'], 'report.txt', data, len(data), sha, 'create')
    assert receipt['status'] == 'committed'
    assert files.transfer(store, scope, grant['id'], 'report.txt', data, len(data), sha, 'create') == receipt
    assert files.read_file(store, scope, grant['id'], 'report.txt') == data
    other = WorkbenchScope('workspace', 'another-user', scope.vault_path, 'agent', 'session')
    with pytest.raises(HTTPException) as error:
        files.read_file(store, other, grant['id'], 'report.txt')
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        files.transfer(store, scope, grant['id'], 'report.txt', data, len(data), sha, 'different-request')
    assert error.value.status_code == 409
    grant['revoked'] = True
    store.update(scope, 'grant', grant['id'], grant)
    with pytest.raises(HTTPException) as error:
        files.transfer(store, scope, grant['id'], 'report.txt', data, len(data), sha, 'create')
    assert error.value.status_code == 403


def test_paths_cannot_escape_or_follow_links(setup):
    store, scope, root = setup
    grant = files.grant_folder(store, scope, str(root), token(scope, root))
    secret = root.parent / 'secret.txt'
    secret.write_text('private')
    (root / 'link').symlink_to(secret)
    for path in ('../secret.txt', str(secret), 'link', '.hidden'):
        with pytest.raises(HTTPException):
            files.read_file(store, scope, grant['id'], path)
    moved = root.parent / 'moved'
    root.rename(moved)
    root.mkdir()
    with pytest.raises(HTTPException) as error:
        files.list_files(store, scope, grant['id'])
    assert error.value.status_code == 409


def test_receipts_survive_reopen_and_unknown_never_replays(setup):
    store, scope, _ = setup
    won, receipt = store.claim(scope, 'document-apply', 'request', 'fingerprint')
    assert won and receipt['status'] == 'unknown'
    reopened = WorkbenchStore(store.path)
    won, receipt = reopened.claim(scope, 'document-apply', 'request', 'fingerprint')
    assert not won and receipt['status'] == 'unknown'
    with pytest.raises(HTTPException):
        reopened.claim(scope, 'document-apply', 'request', 'other-input')


def test_analysis_refuses_host_fallback(setup, monkeypatch):
    store, scope, _ = setup
    monkeypatch.setattr(analysis.shutil, 'which', lambda _: None)
    assert asyncio.run(analysis.status())['available'] is False
    with pytest.raises(HTTPException) as error:
        asyncio.run(analysis.execute(store, scope, 'raise Exception("must not run on host")', 'analysis'))
    assert error.value.status_code == 503
    assert store.list(scope, 'analysis') == []


def test_document_conflict_committed_and_duplicate_receipts(setup, monkeypatch):
    from types import SimpleNamespace
    import backend.api
    from fastapi import BackgroundTasks
    from backend.services import agent_workspace_documents as documents
    from backend.services.workspace_service import WorkspaceContext
    store, scope, _ = setup
    session = store.create(scope, 'document', dict(page_id='page-identity', title='Original', content='old', etag='original-revision'))
    calls = []

    async def patch(page_id, request, background_tasks, context):
        calls.append((page_id, request))
        if request.content == 'conflicting edit':
            raise HTTPException(409, 'stale')
        return dict(id=page_id, content=request.content, etag='new-revision')

    monkeypatch.setattr(backend.api, 'vault_routes', SimpleNamespace(patch_page=patch), raising=False)
    context = WorkspaceContext(scope.workspace_id, scope.user_id, 'editor', Path(scope.vault_path))
    conflict = asyncio.run(documents.apply(store, scope, session['id'], 'conflicting edit', 'conflict', context, BackgroundTasks()))
    assert conflict['status'] == 'conflict'
    assert calls[-1][1].expected_etag == 'original-revision'
    assert calls[-1][1].force is False
    receipt = asyncio.run(documents.apply(store, scope, session['id'], 'accepted edit', 'apply', context, BackgroundTasks()))
    assert receipt['status'] == 'committed'
    assert receipt['page_id'] == 'page-identity'
    repeated = asyncio.run(documents.apply(store, scope, session['id'], 'accepted edit', 'apply', context, BackgroundTasks()))
    assert repeated == receipt and len(calls) == 2
    preview = documents.preview(store, scope, session['id'], 'proposed')
    assert '-accepted edit' in preview['diff'] and '+proposed' in preview['diff']


def test_document_uncertain_result_does_not_repeat_mutation(setup, monkeypatch):
    from types import SimpleNamespace
    import backend.api
    from fastapi import BackgroundTasks
    from backend.services import agent_workspace_documents as documents
    from backend.services.workspace_service import WorkspaceContext
    store, scope, _ = setup
    session = store.create(scope, 'document', dict(page_id='page', content='old', etag='revision'))
    calls = []

    async def interrupted(*args):
        calls.append(True)
        raise RuntimeError('Simulated write acknowledgement loss')

    monkeypatch.setattr(backend.api, 'vault_routes', SimpleNamespace(patch_page=interrupted), raising=False)
    context = WorkspaceContext(scope.workspace_id, scope.user_id, 'editor', Path(scope.vault_path))
    with pytest.raises(RuntimeError):
        asyncio.run(documents.apply(store, scope, session['id'], 'new', 'request', context, BackgroundTasks()))
    receipt = asyncio.run(documents.apply(store, scope, session['id'], 'new', 'request', context, BackgroundTasks()))
    assert receipt['status'] == 'unknown' and len(calls) == 1


def test_document_session_advances_and_old_retry_stays_idempotent(setup, monkeypatch):
    from types import SimpleNamespace
    import backend.api
    from fastapi import BackgroundTasks
    from backend.services import agent_workspace_documents as documents
    from backend.services.workspace_service import WorkspaceContext
    store, scope, _ = setup
    session = store.create(scope, 'document', dict(page_id='page', content='old', etag='v1'))
    calls = []

    async def patch(page_id, request, background_tasks, context):
        calls.append(request.expected_etag)
        return dict(id=page_id, content=request.content, etag=f'v{len(calls)+1}')

    monkeypatch.setattr(backend.api, 'vault_routes', SimpleNamespace(patch_page=patch), raising=False)
    context = WorkspaceContext(scope.workspace_id, scope.user_id, 'editor', Path(scope.vault_path))
    first = asyncio.run(documents.apply(store, scope, session['id'], 'first', 'first', context, BackgroundTasks()))
    second = asyncio.run(documents.apply(store, scope, session['id'], 'second', 'second', context, BackgroundTasks()))
    assert first['status'] == second['status'] == 'committed'
    assert calls == ['v1', 'v2']
    assert store.get(scope, 'document', session['id'])['content'] == 'second'
    assert asyncio.run(documents.apply(store, scope, session['id'], 'first', 'first', context, BackgroundTasks())) == first
    assert len(calls) == 2


def test_workspace_tool_descriptors_hide_scope_and_guard_mutations(monkeypatch):
    from backend.services.agent_workspace_tools import workspace_tool_contributions
    tools, metadata, guarded = workspace_tool_contributions('agent')
    assert len(tools) == len(metadata) == 11
    assert {'workspace_write_new_text', 'workspace_execute_python', 'workspace_apply_document', 'workspace_native_request'} <= guarded
    for item in metadata:
        assert item['minimum_role'] == 'editor'
        properties = item['_descriptor'].input_schema['properties']
        assert not {'config', 'agent_id', 'session_id', 'user_id', 'workspace_id'} & properties.keys()
        if item['name'] in guarded:
            assert item['confirmation'] == 'always'


def test_analysis_isolation_flags_artifacts_and_prior_inputs(setup, monkeypatch):
    store, scope, _ = setup
    commands = []

    class Process:
        def __init__(self, output=b''):
            self.returncode = 0
            self.stdout = asyncio.StreamReader()
            self.stdout.feed_data(output)
            self.stdout.feed_eof()
        async def wait(self):
            return 0
        def kill(self):
            pass

    async def spawn(*args, **kwargs):
        commands.append(args)
        if 'run' in args:
            payload = dict(output='result', exit_code=0, artifacts=[dict(name='result.txt', data=base64.b64encode(b'generated').decode())])
            if len([c for c in commands if 'run' in c]) == 2:
                source_mount = next(c for c in args if isinstance(c, str) and 'dst=/inputs,readonly' in c)
                host_path = Path(source_mount.split('src=')[1].split(',dst=')[0])
                assert (host_path / 'result.txt').read_bytes() == b'generated'
            return Process(json.dumps(payload).encode())
        return Process()

    monkeypatch.setattr(analysis.shutil, 'which', lambda _: '/synthetic/docker')
    monkeypatch.setattr(analysis.asyncio, 'create_subprocess_exec', spawn)
    result = asyncio.run(analysis.execute(store, scope, 'print(1)', 'run-one'))
    assert result['status'] == 'completed'
    assert result['artifacts'][0]['sha256'] == hashlib.sha256(b'generated').hexdigest()
    second = asyncio.run(analysis.execute(store, scope, 'print(2)', 'run-two', [dict(identity='run-one', name='result.txt')]))
    assert second['status'] == 'completed'
    command = next(c for c in commands if 'run' in c)
    for flag in ('--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--pids-limit=64', '--user'):
        assert flag in command
    assert '/work:rw,noexec,nosuid,size=32m,mode=1777' in command
    assert not any('dst=/work' in str(arg) for arg in command)


def test_runtime_tool_uses_injected_conversation_config(setup, monkeypatch):
    from backend.services import agent_workspace_tools as module
    store, scope, _ = setup
    observed = []

    def scoped(agent_id, config):
        observed.append((agent_id, config['configurable']['workbench_session_id']))
        return scope

    monkeypatch.setattr(module, 'conversation_scope', scoped)
    monkeypatch.setattr(module, 'WorkbenchStore', lambda: store)
    tools, _, _ = module.workspace_tool_contributions('trusted-agent')
    grants = next(tool for tool in tools if tool.name == 'workspace_list_grants')
    assert grants.invoke({}, config={'configurable': {'workbench_session_id': 'trusted-session'}}) == '[]'
    assert observed == [('trusted-agent', 'trusted-session')]
    native_tool = next(tool for tool in tools if tool.name == 'workspace_native_request')
    receipt = json.loads(native_tool.invoke(dict(operation=dict(action='browser-open', url='https://example.com'), request_id='native'), config={'configurable': {'workbench_session_id': 'trusted-session'}}))
    assert receipt['status'] == 'pending'
    assert receipt['operation']['url'] == 'https://example.com'


def test_stale_analysis_is_unknown_and_cancel_removes_artifacts(setup):
    store, scope, _ = setup
    store.create(scope, 'analysis', dict(status='running', created_at=time.time()-60), 'stale')
    assert analysis.receipt_status(store, scope, 'stale')['status'] == 'unknown'
    folder = store.path.parent / 'agent-workspace-artifacts' / scope.key / hashlib.sha256(b'stale').hexdigest()
    folder.mkdir(parents=True)
    (folder / 'output.txt').write_text('output')
    assert asyncio.run(analysis.cancel(store, scope, 'stale'))['reason'] == 'cancelled'
    assert not folder.exists()


@pytest.mark.parametrize('field,value', [('workspace_id', 'other-workspace'), ('user_id', 'other-user'), ('vault_path', '/synthetic/other-vault')])
def test_native_grant_scope_mismatch_cannot_consume_selection(setup, field, value):
    store, scope, root = setup
    selection = token(scope, root)
    attacker = replace(scope, **{field: value})
    with pytest.raises(HTTPException) as error:
        files.grant_folder(store, attacker, str(root), selection)
    assert error.value.status_code == 403
    assert store.list(attacker, 'grant') == []
    grant = files.grant_folder(store, scope, str(root), selection)
    assert grant['path'] == str(root)


def test_native_grant_requires_scope_binding(setup):
    store, scope, root = setup
    signed = token(scope, root)
    payload = signed.split('.')[0]
    data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    del data['scope_key']
    unbound_payload = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')
    unbound = unbound_payload + '.' + hmac.new(b'synthetic-test-secret', unbound_payload.encode(), hashlib.sha256).hexdigest()
    with pytest.raises(HTTPException) as error:
        files.grant_folder(store, scope, str(root), unbound)
    assert error.value.status_code == 403
    assert files.grant_folder(store, scope, str(root), signed)['path'] == str(root)


@pytest.mark.skipif(not hasattr(os, 'mkfifo'), reason='FIFO requires POSIX')
def test_fifo_is_rejected_without_waiting_for_a_writer(setup):
    store, scope, root = setup
    grant = files.grant_folder(store, scope, str(root), token(scope, root))
    os.mkfifo(root / 'pipe')
    script = """
import json, sys
from pathlib import Path
from fastapi import HTTPException
from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore
from backend.services.agent_workspace_files import read_file
store = WorkbenchStore(Path(sys.argv[1]))
scope = WorkbenchScope(**json.loads(sys.argv[2]))
try:
    read_file(store, scope, sys.argv[3], 'pipe')
except HTTPException as error:
    sys.exit(0 if error.status_code == 422 else 2)
sys.exit(3)
"""
    result = subprocess.run([sys.executable, '-c', script, str(store.path), json.dumps(scope.__dict__), grant['id']], capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr


def test_analysis_cancel_before_post_prevents_later_execution(setup, monkeypatch):
    store, scope, _ = setup
    monkeypatch.setattr(analysis.shutil, 'which', lambda _: pytest.fail('Cancelled request probed or launched Docker'))
    cancelled = asyncio.run(analysis.cancel(store, scope, 'cancelled-before-post'))
    assert cancelled['reason'] == 'cancelled'
    result = asyncio.run(analysis.execute(store, scope, 'print("must not run")', 'cancelled-before-post'))
    assert result['status'] == 'stopped' and result['reason'] == 'cancelled'


def test_analysis_cancel_during_preparation_prevents_spawn(setup, monkeypatch):
    store, scope, _ = setup

    async def preparing():
        await analysis.cancel(store, scope, 'preparing')
        return dict(available=True)

    monkeypatch.setattr(analysis, 'status', preparing)
    monkeypatch.setattr(analysis.shutil, 'which', lambda _: pytest.fail('Cancelled preparation launched Docker'))
    result = asyncio.run(analysis.execute(store, scope, 'print("must not run")', 'preparing'))
    assert result['reason'] == 'cancelled'


def test_analysis_cancel_while_staging_prevents_container_creation(setup, monkeypatch):
    store, scope, _ = setup

    async def ready():
        return dict(available=True)

    async def cleanup_container(name):
        return None

    def staging(*args):
        store.claim(scope, 'analysis-cancel', 'staging', 'cancelled')

    async def must_not_spawn(*args, **kwargs):
        pytest.fail('Cancelled staging created a container')

    monkeypatch.setattr(analysis, 'status', ready)
    monkeypatch.setattr(analysis, '_stage_inputs', staging)
    monkeypatch.setattr(analysis, 'remove_container', cleanup_container)
    monkeypatch.setattr(analysis.asyncio, 'create_subprocess_exec', must_not_spawn)
    result = asyncio.run(analysis.execute(store, scope, 'print("must not run")', 'staging'))
    assert result['reason'] == 'cancelled'
    assert store.get(scope, 'analysis', 'staging')['status'] == 'stopped'
