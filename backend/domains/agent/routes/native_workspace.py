"""Authenticated native work queue. Native actions are approved in the desktop host."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field

from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.workspace import ScopeRequest, scope_for
from backend.services import agent_native_bridge as bridge
from backend.services.agent_workspace_store import WorkbenchStore
from backend.services.workspace_service import WorkspaceContext, require_role


class NativeOperation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['browser-open', 'browser-snapshot', 'browser-click', 'browser-type',
                    'browser-takeover', 'browser-stop', 'app-open', 'app-type', 'messages-compose', 'revoke']
    url: str | None = Field(default=None, max_length=4096)
    selector: str | None = Field(default=None, max_length=1000)
    text: str | None = Field(default=None, max_length=16000)


class NativeRequest(ScopeRequest):
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')
    operation: NativeOperation


class NativeCompletion(ScopeRequest):
    lease: str = Field(pattern='^[a-f0-9]{32}$')
    result: dict[str, Any]


@router.get('/workspace/native-scope')
def native_scope(agent_id: str, session_id: str,
                 context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, str]:
    return {'scope_key': scope_for(context, agent_id, session_id).key}


@router.get('/workspace/native')
def native_requests(agent_id: str, session_id: str,
                    context: WorkspaceContext = Depends(require_role('editor'))) -> list[dict[str, Any]]:
    return bridge.requests(WorkbenchStore(), scope_for(context, agent_id, session_id))


@router.post('/workspace/native')
def native_enqueue(payload: NativeRequest,
                   context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return bridge.enqueue(WorkbenchStore(), scope_for(context, payload.agent_id, payload.session_id),
                          payload.request_id, payload.operation.model_dump(exclude_none=True))


@router.post('/workspace/native/{identity}/claim')
def native_claim(identity: str, payload: ScopeRequest,
                 context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return bridge.claim(WorkbenchStore(), scope_for(context, payload.agent_id, payload.session_id), identity)


@router.post('/workspace/native/{identity}/complete')
def native_complete(identity: str, payload: NativeCompletion,
                    context: WorkspaceContext = Depends(require_role('editor'))) -> dict[str, Any]:
    return bridge.complete(WorkbenchStore(), scope_for(context, payload.agent_id, payload.session_id),
                           identity, payload.lease, payload.result)
