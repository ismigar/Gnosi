"""Governed tools bound to authenticated runtime scope and trusted conversation config."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from fastapi import BackgroundTasks
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from backend.models.agent_skills import CatalogOrigin, ConfirmationPolicy, OriginType, ToolDescriptor, ToolEffect
from backend.services import agent_workspace_analysis as analysis
from backend.services import agent_workspace_documents as documents
from backend.services import agent_workspace_files as files
from backend.services import agent_native_bridge as native
from backend.services.agent_execution_scope import current_scope, revalidate_scope
from backend.services.agent_workspace_store import WorkbenchScope, WorkbenchStore
from backend.services.workspace_service import ROLE_WEIGHTS, WorkspaceContext


class EmptyInput(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ListInput(EmptyInput):
    grant_id: str = Field(max_length=128)
    path: str = Field(default='', max_length=1024)


class WriteInput(ListInput):
    content: str = Field(max_length=1_000_000)
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


class ArtifactInput(EmptyInput):
    identity: str = Field(max_length=128)
    name: str = Field(max_length=255)


class AnalysisInput(EmptyInput):
    code: str = Field(max_length=100_000)
    inputs: list[ArtifactInput] = Field(default_factory=list, max_length=10)
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


class IdentityInput(EmptyInput):
    identity: str = Field(max_length=128)


class CaptureInput(EmptyInput):
    page_id: str = Field(max_length=128)


class PreviewInput(IdentityInput):
    content: str = Field(max_length=documents.MAX_DOCUMENT_CHARS)


class ApplyInput(PreviewInput):
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


class NativeOperation(EmptyInput):
    action: Literal['browser-open', 'browser-snapshot', 'browser-click', 'browser-type', 'browser-takeover', 'browser-stop', 'app-open', 'app-type', 'messages-compose', 'revoke']
    url: str | None = Field(default=None, max_length=4096)
    selector: str | None = Field(default=None, max_length=1000)
    text: str | None = Field(default=None, max_length=16000)


class NativeInput(EmptyInput):
    operation: NativeOperation
    request_id: str = Field(pattern='^[A-Za-z0-9_-]{1,128}$')


def conversation_scope(agent_id: str, config: RunnableConfig) -> WorkbenchScope:
    """Config is injected by LangChain, unavailable as a model argument."""
    from backend.domains.agent.routes.shared import _validated_identifier
    principal = current_scope()
    revalidate_scope(principal)
    if ROLE_WEIGHTS.get(principal.role, -1) < ROLE_WEIGHTS['editor']:
        raise PermissionError('Workbench requires editor permission')
    session_id = str((config.get('configurable') or {}).get('workbench_session_id') or '')
    return WorkbenchScope(principal.workspace_id, principal.user_id, principal.vault_path, _validated_identifier(agent_id, 'agent_id'), _validated_identifier(session_id, 'session_id'))


def workspace_tool_contributions(agent_id: str) -> tuple[list[Any], list[dict[str, Any]], set[str]]:
    """Contribute descriptors through the existing dynamic-context policy boundary."""
    def grants(config: RunnableConfig) -> str:
        values = WorkbenchStore().list(conversation_scope(agent_id, config), 'grant')
        return json.dumps([dict(id=g['id'], name=g['name']) for g in values if not g['revoked']])

    def listing(grant_id: str, config: RunnableConfig, path: str = '') -> str:
        return json.dumps(files.list_files(WorkbenchStore(), conversation_scope(agent_id, config), grant_id, path))

    def reading(grant_id: str, config: RunnableConfig, path: str = '') -> str:
        data = files.read_file(WorkbenchStore(), conversation_scope(agent_id, config), grant_id, path)
        if len(data) > 1_000_000:
            raise ValueError('Tool text reading is limited to 1 MB; use a scoped download')
        return data.decode('utf-8')

    def writing(grant_id: str, path: str, content: str, request_id: str, config: RunnableConfig) -> str:
        data = content.encode()
        return json.dumps(files.transfer(WorkbenchStore(), conversation_scope(agent_id, config), grant_id, path, data, len(data), hashlib.sha256(data).hexdigest(), request_id))

    async def executing(code: str, request_id: str, config: RunnableConfig, inputs: list[ArtifactInput] | None = None) -> str:
        return json.dumps(await analysis.execute(WorkbenchStore(), conversation_scope(agent_id, config), code, request_id, [item.model_dump() for item in (inputs or [])]))

    def analysis_result(identity: str, config: RunnableConfig) -> str:
        return json.dumps(analysis.receipt_status(WorkbenchStore(), conversation_scope(agent_id, config), identity))

    async def capturing(page_id: str, config: RunnableConfig) -> str:
        return json.dumps(await documents.capture(WorkbenchStore(), conversation_scope(agent_id, config), page_id))

    def previewing(identity: str, content: str, config: RunnableConfig) -> str:
        return json.dumps(documents.preview(WorkbenchStore(), conversation_scope(agent_id, config), identity, content))

    async def applying(identity: str, content: str, request_id: str, config: RunnableConfig) -> str:
        from pathlib import Path
        scope = conversation_scope(agent_id, config)
        context = WorkspaceContext(scope.workspace_id, scope.user_id, current_scope().role, Path(scope.vault_path))
        background = BackgroundTasks()
        result = await documents.apply(WorkbenchStore(), scope, identity, content, request_id, context, background)
        await background()
        return json.dumps(result)

    def native_request(operation: NativeOperation, request_id: str, config: RunnableConfig) -> str:
        return json.dumps(native.enqueue(WorkbenchStore(), conversation_scope(agent_id, config), request_id, operation.model_dump(exclude_none=True)))

    def native_result(identity: str, config: RunnableConfig) -> str:
        scope = conversation_scope(agent_id, config)
        native.requests(WorkbenchStore(), scope)
        return json.dumps(native.public(WorkbenchStore().get(scope, 'native-request', identity)))

    definitions: list[tuple[str, str, Any, Any, Any, list[ToolEffect]]] = [
        ('workspace_list_grants', 'List folders already authorized for this conversation.', grants, None, EmptyInput, [ToolEffect.READ]),
        ('workspace_list_files', 'List a relative directory inside an authorized folder.', listing, None, ListInput, [ToolEffect.READ]),
        ('workspace_read_text', 'Read a bounded UTF-8 file inside an authorized folder.', reading, None, ListInput, [ToolEffect.READ, ToolEffect.PERSONAL_DATA]),
        ('workspace_write_new_text', 'Create a UTF-8 file without replacing existing files.', writing, None, WriteInput, [ToolEffect.LOCAL_WRITE]),
        ('workspace_execute_python', 'Execute Python in Docker with no network and bounded writable tmpfs. Optional prior artifacts are read-only at /inputs/name; save new artifacts in /work. Refuses unavailable isolation.', None, executing, AnalysisInput, [ToolEffect.CODE_EXECUTION]),
        ('workspace_analysis_result', 'Inspect the receipt and generated artifacts of an analysis request.', analysis_result, None, IdentityInput, [ToolEffect.READ]),
        ('workspace_capture_document', 'Capture a page and revision for an editable session.', None, capturing, CaptureInput, [ToolEffect.READ]),
        ('workspace_preview_document', 'Preview a proposed page edit without writing the page.', previewing, None, PreviewInput, [ToolEffect.READ]),
        ('workspace_apply_document', 'Apply an editable page session with its captured revision. Conflicts never overwrite.', None, applying, ApplyInput, [ToolEffect.LOCAL_WRITE]),
        ('workspace_native_request', 'Queue a desktop/browser operation. The desktop requires user consent before executing it; messages-compose opens a draft only.', native_request, None, NativeInput, [ToolEffect.EXTERNAL_WRITE, ToolEffect.PERSONAL_DATA]),
        ('workspace_native_result', 'Inspect a desktop request; unknown outcomes must never be replayed.', native_result, None, IdentityInput, [ToolEffect.READ]),
    ]
    tools: list[Any] = []
    metadata: list[dict[str, Any]] = []
    guarded: set[str] = set()
    for name, description, function, coroutine, schema, effects in definitions:
        tool = StructuredTool.from_function(function, coroutine=coroutine, name=name, description=description, args_schema=schema)
        writes = any(effect in {ToolEffect.LOCAL_WRITE, ToolEffect.CODE_EXECUTION, ToolEffect.EXTERNAL_WRITE} for effect in effects)
        descriptor = ToolDescriptor(id=f'core.{name.replace("_", "-")}', name=name, description=description, origin=CatalogOrigin(type=OriginType.CORE, id='gnosi'), input_schema=schema.model_json_schema(), effects=effects, minimum_role='editor', confirmation=ConfirmationPolicy.ALWAYS if writes else ConfirmationPolicy.NONE, metadata={'dynamic_context': True, 'workbench': True})
        item = dict(id=descriptor.id, name=name, effects=[effect.value for effect in effects], skill_ids=[], minimum_role='editor', confirmation=descriptor.confirmation.value, prepares_confirmation=False, dynamic_context=True, workbench=True, _descriptor=descriptor)
        tools.append(tool)
        metadata.append(item)
        if writes:
            guarded.add(name)
    return tools, metadata, guarded
