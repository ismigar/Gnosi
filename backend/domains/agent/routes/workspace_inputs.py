"""Verified user-selected files imported into the task's isolated analysis inputs."""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException
from pydantic import Field

from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.workspace import ScopeRequest, scope_for
from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore
from backend.services.workspace_service import WorkspaceContext, require_role


class AnalysisImportRequest(ScopeRequest):
    name: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(max_length=20_000_000)
    size: int = Field(ge=0, le=15_000_000)
    sha256: str = Field(pattern='^[a-f0-9]{64}$')
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


def import_input(store: WorkbenchStore, scope: WorkbenchScope, request: AnalysisImportRequest) -> dict[str, Any]:
    name = request.name
    if Path(name).name != name or name.startswith('.') or any(char in name for char in '/\\\x00'):
        raise HTTPException(422, 'Invalid input file name')
    try:
        data = base64.b64decode(request.content_base64, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, 'Invalid file encoding') from None
    if len(data) != request.size or hashlib.sha256(data).hexdigest() != request.sha256:
        raise HTTPException(422, 'Input integrity verification failed')
    fingerprint = hashlib.sha256(json.dumps([name, request.size, request.sha256]).encode()).hexdigest()
    fresh, receipt = store.claim(scope, 'analysis', request.request_id, fingerprint)
    if not fresh:
        return receipt
    destination = store.path.parent / 'agent-workspace-artifacts' / scope.key / hashlib.sha256(request.request_id.encode()).hexdigest()
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (destination / name).open('xb') as handle:
        handle.write(data)
    (destination / name).chmod(0o600)
    receipt.update(status='imported', artifacts=[{'name': name, 'size': len(data), 'sha256': request.sha256}])
    return store.update(scope, 'analysis', request.request_id, receipt)


@router.post('/workspace/analysis-inputs')
def upload_analysis_input(request: AnalysisImportRequest,
                          context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return import_input(WorkbenchStore(), scope_for(context, request.agent_id, request.session_id), request)
