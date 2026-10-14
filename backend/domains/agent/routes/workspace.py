"""Authenticated agent workbench: native folder grants, files, pages and analysis."""
from __future__ import annotations

from typing import Any, cast

import base64
import binascii
import hashlib
from pathlib import Path
from urllib.parse import quote

from fastapi import BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.shared import _validated_identifier
from backend.services import agent_workspace_analysis as analysis
from backend.services import agent_workspace_documents as documents
from backend.services import agent_workspace_files as files
from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore
from backend.services.workspace_service import WorkspaceContext, require_role


class ScopeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    agent_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)


class GrantRequest(ScopeRequest):
    path: str = Field(max_length=4096)
    selection_token: str = Field(max_length=12000)


class FileRequest(ScopeRequest):
    grant_id: str = Field(max_length=128)
    path: str = Field(default='', max_length=1024)


class TransferRequest(FileRequest):
    content_base64: str = Field(max_length=21_000_000)
    size: int = Field(ge=0, le=files.MAX_FILE_BYTES)
    sha256: str = Field(pattern='^[a-f0-9]{64}$')
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


class DocumentRequest(ScopeRequest):
    page_id: str = Field(min_length=1, max_length=128)


class PreviewRequest(ScopeRequest):
    content: str = Field(max_length=documents.MAX_DOCUMENT_CHARS)


class ApplyRequest(PreviewRequest):
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


class AnalysisArtifactInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    identity: str = Field(max_length=128)
    name: str = Field(max_length=255)


class AnalysisRequest(ScopeRequest):
    code: str = Field(max_length=100_000)
    inputs: list[AnalysisArtifactInput] = Field(default_factory=list, max_length=10)
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


def scope_for(context: WorkspaceContext, agent_id: str, session_id: str) -> WorkbenchScope:
    return WorkbenchScope(context.workspace_id, context.user_id, str(context.vault_path.resolve()), _validated_identifier(agent_id, 'agent_id'), _validated_identifier(session_id, 'session_id'))


@router.get('/workspace/status')
async def workbench_status(context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    import os
    return dict(native_folder_picker=bool(os.environ.get('GNOSI_DESKTOP_SELECTION_SECRET')), analysis=await analysis.status())


@router.get('/workspace/grants')
def list_grants(agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> list[dict[str, Any]]:
    return WorkbenchStore().list(scope_for(context, agent_id, session_id), 'grant')


@router.post('/workspace/grants')
def create_grant(request: GrantRequest, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return files.grant_folder(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), request.path, request.selection_token)


@router.delete('/workspace/grants/{grant_id}')
def revoke_grant(grant_id: str, agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    store = WorkbenchStore()
    scope = scope_for(context, agent_id, session_id)
    grant = store.get(scope, 'grant', grant_id)
    grant['revoked'] = True
    return store.update(scope, 'grant', grant_id, grant)


@router.post('/workspace/files/list')
def workbench_list(request: FileRequest, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return files.list_files(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), request.grant_id, request.path)


@router.post('/workspace/files/read')
def workbench_read(request: FileRequest, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    data = files.read_file(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), request.grant_id, request.path)
    return dict(content_base64=base64.b64encode(data).decode(), size=len(data), sha256=hashlib.sha256(data).hexdigest())


@router.post('/workspace/transfers')
def workbench_transfer(request: TransferRequest, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    try:
        data = base64.b64decode(request.content_base64, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, 'Invalid base64 content') from None
    return files.transfer(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), request.grant_id, request.path, data, request.size, request.sha256, request.request_id)


@router.get('/workspace/download')
def workbench_download(agent_id: str, session_id: str, grant_id: str, path: str = Query(max_length=1024), context: WorkspaceContext = Depends(require_role('editor'))) -> Response:
    data = files.read_file(WorkbenchStore(), scope_for(context, agent_id, session_id), grant_id, path)
    return Response(data, media_type='application/octet-stream', headers={'X-Content-SHA256': hashlib.sha256(data).hexdigest(), 'Content-Disposition': "attachment; filename*=UTF-8''" + quote(Path(path).name, safe=''), 'Cache-Control': 'no-store'})


@router.post('/workspace/documents')
async def capture_document(request: DocumentRequest, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return await documents.capture(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), request.page_id)


@router.post('/workspace/documents/{identity}/preview')
def preview_document(identity: str, request: PreviewRequest, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return documents.preview(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), identity, request.content)


@router.post('/workspace/documents/{identity}/apply')
async def apply_document(identity: str, request: ApplyRequest, background_tasks: BackgroundTasks, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return await documents.apply(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), identity, request.content, request.request_id, context, background_tasks)


@router.post('/workspace/analysis')
async def run_analysis(request: AnalysisRequest, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return await analysis.execute(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), request.code, request.request_id, [item.model_dump() for item in request.inputs])


@router.get('/workspace/analysis/{identity}')
def get_analysis(identity: str, agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return analysis.receipt_status(WorkbenchStore(), scope_for(context, agent_id, session_id), identity)


@router.delete('/workspace/analysis/{identity}')
async def cancel_analysis(identity: str, agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return await analysis.cancel(WorkbenchStore(), scope_for(context, agent_id, session_id), identity)


@router.get('/workspace/analysis/{identity}/artifacts/{name}')
def download_artifact(identity: str, name: str, agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> Response:
    store = WorkbenchStore()
    scope = scope_for(context, agent_id, session_id)
    receipt = store.get(scope, 'analysis', identity)
    entry = next((a for a in receipt.get('artifacts', []) if a['name'] == name), None)
    if entry is None or Path(name).name != name or name.startswith('.'):
        raise HTTPException(404, 'Artifact not found')
    target = store.path.parent / 'agent-workspace-artifacts' / scope.key / hashlib.sha256(identity.encode()).hexdigest() / name
    data = target.read_bytes()
    if len(data) != entry['size'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise HTTPException(409, 'Artifact integrity verification failed')
    return Response(data, media_type='application/octet-stream', headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(name, safe=''), 'Cache-Control': 'no-store'})


@router.get('/workspace/documents')
def list_documents(agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> list[dict[str, Any]]:
    values = WorkbenchStore().list(scope_for(context, agent_id, session_id), 'document')
    return [{key: value[key] for key in ('id', 'page_id', 'title', 'etag', 'status') if key in value} for value in values]


@router.get('/workspace/documents/{identity}')
def get_document(identity: str, agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return WorkbenchStore().get(scope_for(context, agent_id, session_id), 'document', identity)


@router.get('/workspace/analysis')
def list_analysis(agent_id: str, session_id: str, context: WorkspaceContext = Depends(require_role('editor'))) -> list[dict[str, Any]]:
    store = WorkbenchStore()
    scope = scope_for(context, agent_id, session_id)
    values = [analysis.receipt_status(store, scope, value['id']) for value in store.list(scope, 'analysis')]
    return [{key: value[key] for key in ('id', 'status', 'reason', 'created_at', 'exit_code', 'artifacts') if key in value} for value in values]
