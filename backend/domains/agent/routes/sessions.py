import asyncio
import copy
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

from fastapi import Depends, HTTPException, Query
from langgraph.checkpoint.base import create_checkpoint
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.agent.action_confirmations import cancel_scope_confirmations
from backend.domains.agent.routes.checkpoints import (
    _chat_thread_id,
    _checkpoint_key,
    _public_checkpoint_messages,
    _rewound_checkpoint_messages,
    _thread_lock,
)
from backend.domains.agent.routes.contracts import ChatRewindRequest
from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.shared import (
    _notebook_conversation_scope,
    _validated_identifier,
    _vault_scope,
)
from backend.domains.agent.routes.state import cfg
from backend.services.workspace_service import WorkspaceContext, require_role


@router.delete(
    "/chat/sessions/{agent_id}/{session_id}",
    response_model=None,
)
async def delete_chat_session(
    agent_id: str,
    session_id: str,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
    notebook_id: Optional[str] = Query(default=None, max_length=64),
) -> Any:
    """Remove the persisted LangGraph checkpoints for one scoped chat thread."""
    safe_agent_id = _validated_identifier(agent_id, "agent_id")
    notebook_scope = _notebook_conversation_scope(notebook_id, workspace_context, mutation="clear")
    safe_session_id = _validated_identifier(
        str((notebook_scope or {}).get("session_id") or session_id), "session_id"
    )
    principal = str((notebook_scope or {}).get("principal") or workspace_context.user_id)
    _vault, vault_scope = _vault_scope()
    thread_id = _chat_thread_id(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=principal,
        agent_id=safe_agent_id,
        session_id=safe_session_id,
    )
    checkpoint_key = _checkpoint_key(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=principal,
        agent_id=safe_agent_id,
    )
    db_path = cast(Path, cfg.paths["CHECKPOINTS"]) / f"agent_{checkpoint_key}.sqlite"
    if db_path.exists():
        async with _thread_lock(thread_id):
            async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                await saver.adelete_thread(thread_id)
    await asyncio.to_thread(
        cancel_scope_confirmations,
        {
            "vault_scope": vault_scope,
            "workspace_id": workspace_context.workspace_id,
            "user_id": workspace_context.user_id,
            "role": workspace_context.role,
            "agent_id": safe_agent_id,
            "session_id": safe_session_id,
        },
    )
    return {"deleted": True}


@router.post(
    "/chat/sessions/{agent_id}/{session_id}/rewind",
    response_model=None,
)
async def rewind_chat_session(
    agent_id: str,
    session_id: str,
    payload: ChatRewindRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
    notebook_id: Optional[str] = Query(default=None, max_length=64),
) -> Any:
    """Remove one turn and its suffix from the scoped canonical checkpoint."""
    safe_agent_id = _validated_identifier(agent_id, "agent_id")
    notebook_scope = _notebook_conversation_scope(notebook_id, workspace_context, mutation="rewind")
    safe_session_id = _validated_identifier(
        str((notebook_scope or {}).get("session_id") or session_id), "session_id"
    )
    principal = str((notebook_scope or {}).get("principal") or workspace_context.user_id)
    _vault, vault_scope = _vault_scope()
    thread_id = _chat_thread_id(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=principal,
        agent_id=safe_agent_id,
        session_id=safe_session_id,
    )
    checkpoint_key = _checkpoint_key(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=principal,
        agent_id=safe_agent_id,
    )
    db_path = cast(Path, cfg.paths["CHECKPOINTS"]) / f"agent_{checkpoint_key}.sqlite"
    public_messages: List[Dict[str, str]] = []

    if db_path.exists():
        async with _thread_lock(thread_id):
            async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                checkpoint_tuple = await saver.aget_tuple(
                    {"configurable": {"thread_id": thread_id}},
                )
                if checkpoint_tuple:
                    stored_messages = list(
                        checkpoint_tuple.checkpoint.get(
                            "channel_values",
                            {},
                        ).get("messages", [])
                    )
                    try:
                        retained_messages = _rewound_checkpoint_messages(
                            stored_messages,
                            before_turn_id=payload.before_turn_id,
                            keep_messages=payload.keep_messages,
                        )
                    except ValueError as error:
                        raise HTTPException(
                            status_code=409,
                            detail={"code": "conversation_turn_unavailable"},
                        ) from error
                    if retained_messages:
                        rewound = cast(Any, copy.deepcopy(checkpoint_tuple.checkpoint))
                        rewound["channel_values"] = dict(
                            rewound.get("channel_values", {}),
                            messages=retained_messages,
                        )
                        rewound["pending_sends"] = []
                        metadata: Dict[str, Any] = dict(checkpoint_tuple.metadata or {})
                        step = int(cast(Any, metadata.get("step", -1))) + 1
                        rewound = create_checkpoint(rewound, None, step)
                        metadata.update({"source": "update", "step": step})
                        checkpoint_ns = str(
                            checkpoint_tuple.config.get(
                                "configurable",
                                {},
                            ).get("checkpoint_ns", "")
                        )
                        base_config = cast(
                            Any,
                            {
                                "configurable": {
                                    "thread_id": thread_id,
                                    "checkpoint_ns": checkpoint_ns,
                                },
                            },
                        )
                        await saver.adelete_thread(thread_id)
                        try:
                            await saver.aput(
                                base_config,
                                rewound,
                                cast(Any, metadata),
                                {},
                            )
                        except Exception:
                            await saver.aput(
                                base_config,
                                checkpoint_tuple.checkpoint,
                                checkpoint_tuple.metadata,
                                {},
                            )
                            raise
                    else:
                        await saver.adelete_thread(thread_id)
                    public_messages = _public_checkpoint_messages(
                        retained_messages,
                    )

    await asyncio.to_thread(
        cancel_scope_confirmations,
        {
            "vault_scope": vault_scope,
            "workspace_id": workspace_context.workspace_id,
            "user_id": workspace_context.user_id,
            "role": workspace_context.role,
            "agent_id": safe_agent_id,
            "session_id": safe_session_id,
        },
    )
    return {"messages": public_messages}


@router.get("/chat/sessions/{agent_id}/{session_id}", response_model=None)
async def get_chat_session(
    agent_id: str,
    session_id: str,
    workspace_context: WorkspaceContext = Depends(require_role("viewer")),
    notebook_id: Optional[str] = Query(default=None, max_length=64),
) -> Any:
    """Return the canonical persisted transcript for one scoped session."""
    safe_agent_id = _validated_identifier(agent_id, "agent_id")
    notebook_scope = _notebook_conversation_scope(notebook_id, workspace_context)
    safe_session_id = _validated_identifier(
        str((notebook_scope or {}).get("session_id") or session_id), "session_id"
    )
    principal = str((notebook_scope or {}).get("principal") or workspace_context.user_id)
    _vault, vault_scope = _vault_scope()
    thread_id = _chat_thread_id(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=principal,
        agent_id=safe_agent_id,
        session_id=safe_session_id,
    )
    checkpoint_key = _checkpoint_key(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=principal,
        agent_id=safe_agent_id,
    )
    db_path = cast(Path, cfg.paths["CHECKPOINTS"]) / f"agent_{checkpoint_key}.sqlite"
    if not db_path.exists():
        return {"messages": []}
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        checkpoint = await saver.aget(
            {"configurable": {"thread_id": thread_id}},
        )
    stored_messages = checkpoint.get("channel_values", {}).get("messages", []) if checkpoint else []
    return {"messages": _public_checkpoint_messages(stored_messages)}
