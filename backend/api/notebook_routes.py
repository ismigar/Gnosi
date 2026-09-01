"""HTTP contracts for the grounded notebook workspace."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from backend.domains.agent.routes.checkpoints import (
    chat_thread_id,
    checkpoint_key,
    public_checkpoint_messages,
    thread_lock,
)
from backend.domains.agent.routes.shared import vault_scope
from backend.domains.notebooks.schemas import (
    NotebookChatSourcesResponse,
    NotebookConversationResponse,
    NotebookCreateRequest,
    NotebookDetailResponse,
    NotebookEvidenceResponse,
    NotebookPageResponse,
    NotebookPatchRequest,
    NotebookRefreshRequest,
    NotebookRefreshResponse,
    NotebookSearchResponse,
    NotebookSourcesPageResponse,
    NotebookSourcesRequest,
    ReferenceResourcePageResponse,
)
from backend.services import notebook_service
from backend.services.workspace_service import WorkspaceContext, require_role

router = APIRouter(prefix="/api/notebooks", tags=["Notebooks"])


@router.get(
    "",
    response_model=NotebookPageResponse,
    response_model_exclude_unset=True,
)
def list_notebooks(
    q: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.list_notebooks(context, query=q, page=page, page_size=page_size)


@router.post(
    "",
    status_code=201,
    response_model=NotebookDetailResponse,
    response_model_exclude_unset=True,
)
def create_notebook(
    payload: NotebookCreateRequest,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> Any:
    return notebook_service.create_notebook(
        context,
        title=payload.title,
        visibility=payload.visibility,
        conversation_mode=payload.conversation_mode,
        resource_ids=payload.resource_ids,
    )


@router.get(
    "/resources",
    response_model=ReferenceResourcePageResponse,
    response_model_exclude_unset=True,
)
def list_reference_resources(
    q: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    notebook_id: str | None = Query(default=None, max_length=64),
    resource_type: str = Query(default="", alias="type", max_length=160),
    author: str = Query(default="", max_length=160),
    tag: str = Query(default="", max_length=160),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.list_reference_resources(
        context,
        query=q,
        page=page,
        page_size=page_size,
        exclude_notebook_id=notebook_id,
        resource_type=resource_type,
        author=author,
        tag=tag,
    )


@router.get(
    "/{notebook_id}",
    response_model=NotebookDetailResponse,
    response_model_exclude_unset=True,
)
def get_notebook(
    notebook_id: str,
    refresh: bool = Query(default=True),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.get_notebook(notebook_id, context, schedule_refresh=refresh)


@router.patch(
    "/{notebook_id}",
    response_model=NotebookDetailResponse,
    response_model_exclude_unset=True,
)
def update_notebook(
    notebook_id: str,
    payload: NotebookPatchRequest,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.update_notebook(
        notebook_id,
        context,
        title=payload.title,
        visibility=payload.visibility,
        conversation_mode=payload.conversation_mode,
        groups=payload.groups,
    )


@router.delete("/{notebook_id}", status_code=204)
async def delete_notebook(
    notebook_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Response:
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    from backend.config.app_config import load_params

    scopes = notebook_service.conversation_scopes(notebook_id, context)
    _vault, vault_scope_id = vault_scope()
    checkpoints_value = load_params(strict_env=False).paths["CHECKPOINTS"]
    if checkpoints_value is None:
        raise RuntimeError("Agent checkpoint storage is not configured.")
    checkpoints_root = Path(checkpoints_value)
    for scope in scopes:
        principal = scope["principal_id"]
        session_id = scope["session_id"]
        thread_id = chat_thread_id(
            vault_scope=vault_scope_id,
            workspace_id=context.workspace_id,
            user_id=principal,
            agent_id="gnosy",
            session_id=session_id,
        )
        checkpoint_id = checkpoint_key(
            vault_scope=vault_scope_id,
            workspace_id=context.workspace_id,
            user_id=principal,
            agent_id="gnosy",
        )
        db_path = checkpoints_root / f"agent_{checkpoint_id}.sqlite"
        if db_path.exists():
            async with thread_lock(thread_id):
                async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                    await saver.adelete_thread(thread_id)
    notebook_service.delete_notebook(notebook_id, context)
    return Response(status_code=204)


@router.get(
    "/{notebook_id}/sources",
    response_model=NotebookSourcesPageResponse,
    response_model_exclude_unset=True,
)
def list_sources(
    notebook_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.list_notebook_sources(
        notebook_id, context, page=page, page_size=page_size
    )


@router.get(
    "/{notebook_id}/chat-sources",
    response_model=NotebookChatSourcesResponse,
    response_model_exclude_unset=True,
)
def list_chat_sources(
    notebook_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.list_chat_source_options(notebook_id, context)


@router.post(
    "/{notebook_id}/sources",
    response_model=NotebookDetailResponse,
    response_model_exclude_unset=True,
)
def add_sources(
    notebook_id: str,
    payload: NotebookSourcesRequest,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.add_resources(notebook_id, context, payload.resource_ids)


@router.delete(
    "/{notebook_id}/sources/{resource_id}",
    response_model=NotebookDetailResponse,
    response_model_exclude_unset=True,
)
def remove_source(
    notebook_id: str,
    resource_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.remove_resource(notebook_id, context, resource_id)


@router.post(
    "/{notebook_id}/sources/{resource_id}/refresh",
    status_code=202,
    response_model=NotebookRefreshResponse,
    response_model_exclude_unset=True,
)
def refresh_resource(
    notebook_id: str,
    resource_id: str,
    payload: NotebookRefreshRequest,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.request_refresh(
        notebook_id,
        context,
        reason=payload.reason or "resource_retry",
        force=True,
        resource_ids=[resource_id],
    )


@router.post(
    "/{notebook_id}/refresh",
    status_code=202,
    response_model=NotebookRefreshResponse,
    response_model_exclude_unset=True,
)
def refresh_notebook(
    notebook_id: str,
    payload: NotebookRefreshRequest,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    notebook_service.authorize(notebook_id, context, action="manage")
    return notebook_service.request_refresh(
        notebook_id,
        context,
        reason=payload.reason,
        force=payload.force,
    )


@router.post(
    "/{notebook_id}/refresh/cancel",
    response_model=NotebookDetailResponse,
    response_model_exclude_unset=True,
)
def cancel_notebook_refresh(
    notebook_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    return notebook_service.cancel_refresh(notebook_id, context)


@router.get(
    "/{notebook_id}/search",
    response_model=NotebookSearchResponse,
    response_model_exclude_unset=True,
)
def search_notebook(
    notebook_id: str,
    q: str = Query(min_length=1, max_length=2_000),
    limit: int = Query(default=12, ge=1, le=50),
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    notebook = notebook_service.authorize(notebook_id, context)
    if notebook.get("active_revision") is None:
        raise HTTPException(status_code=409, detail="The notebook is not ready yet.")
    return notebook_service.search_notebook(notebook_id, q, limit=limit)


@router.get(
    "/{notebook_id}/evidence/{chunk_id}",
    response_model=NotebookEvidenceResponse,
    response_model_exclude_unset=True,
)
def read_evidence(
    notebook_id: str,
    chunk_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
    revision: int | None = Query(default=None, ge=1),
) -> Any:
    notebook_service.authorize(notebook_id, context)
    try:
        return notebook_service.read_notebook_evidence(
            notebook_id,
            chunk_id,
            revision=revision if isinstance(revision, int) else None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/{notebook_id}/conversation",
    response_model=NotebookConversationResponse,
    response_model_exclude_unset=True,
)
async def get_conversation(
    notebook_id: str,
    context: WorkspaceContext = Depends(require_role("viewer")),
) -> Any:
    """Return the canonical shared or per-member notebook transcript."""
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    from backend.config.app_config import load_params

    notebook = notebook_service.authorize(notebook_id, context)
    principal = notebook_service.conversation_principal(notebook, context.user_id)
    session_id = notebook_service.conversation_session_id(notebook)
    _vault, vault_scope_id = vault_scope()
    thread_id = chat_thread_id(
        vault_scope=vault_scope_id,
        workspace_id=context.workspace_id,
        user_id=principal,
        agent_id="gnosy",
        session_id=session_id,
    )
    checkpoint_id = checkpoint_key(
        vault_scope=vault_scope_id,
        workspace_id=context.workspace_id,
        user_id=principal,
        agent_id="gnosy",
    )
    checkpoints_value = load_params(strict_env=False).paths["CHECKPOINTS"]
    if checkpoints_value is None:
        raise RuntimeError("Agent checkpoint storage is not configured.")
    db_path = Path(checkpoints_value) / f"agent_{checkpoint_id}.sqlite"
    if not db_path.exists():
        return {"messages": [], "session_id": session_id}
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        checkpoint = await saver.aget({"configurable": {"thread_id": thread_id}})
    checkpoint_data = cast(dict[str, Any], checkpoint) if isinstance(checkpoint, dict) else {}
    raw_values = checkpoint_data.get("channel_values", {})
    checkpoint_values = cast(dict[str, Any], raw_values) if isinstance(raw_values, dict) else {}
    stored = checkpoint_values.get("messages", [])
    return {
        "messages": public_checkpoint_messages(stored),
        "session_id": session_id,
        "conversation_mode": notebook["conversation_mode"],
    }
