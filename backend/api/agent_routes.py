# ruff: noqa: F401, I001
"""Compatibility facade for the modular agent HTTP routes."""

from __future__ import annotations

import sys
import json
from types import ModuleType
from typing import Any

from langgraph.checkpoint.base import create_checkpoint
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.agent.action_confirmations import cancel_scope_confirmations
from backend.agent.factory import (
    _explicit_brain_write_tool_names,
    build_agent_turn_plan,
    create_agent_workflow,
    prepare_agent_runtime,
)
from backend.agent.gnosi_tools import (
    execute_confirmed_action,
    replace_reference_ids_in_titles,
)
from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.contracts import (
    ACTION_ID_RE,
    ATTACHMENT_EXTRACTION_SECONDS,
    ATTACHMENT_MAX_AGE_SECONDS,
    CHAT_ATTACHMENT_TYPES,
    CONFIRMATION_HEARTBEAT_SECONDS,
    CONFIRMED_ACTION_TIMEOUT_SECONDS,
    FAILURE_MESSAGES,
    IDENTIFIER_RE,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_CONTEXT,
    MAX_ATTACHMENT_TEXT,
    MAX_PDF_PAGES,
    SKILL_IDENTIFIER_RE,
    TURN_LOCK_TIMEOUT_SECONDS,
    TURN_TIMEOUT_SECONDS,
    ActionConfirmationRequest,
    AttachmentDeleteRequest,
    AttachmentRef,
    ChatFeedbackRequest,
    ChatRequest,
    ChatRewindRequest,
    MentionRef,
    TurnContextRef,
)
from backend.domains.agent.routes.checkpoints import (
    SessionBusyError,
    _THREAD_LOCKS,
    _acquire_turn_lock,
    _ai_runtime_revision,
    _chat_thread_id,
    _checkpoint_key,
    _public_checkpoint_message_entries,
    _public_checkpoint_messages,
    _rewound_checkpoint_messages,
    _thread_lock,
)
from backend.domains.agent.routes.shared import (
    _agent_stream_error_code,
    _message_text,
    _notebook_conversation_scope,
    _prepare_index_title_replacements,
    _tool_stream_event,
    _validated_identifier,
    _validated_skill_ids,
    _vault_scope,
)
from backend.domains.agent.routes.attachments import (
    _attachment_context,
    _attachment_root,
    _attachment_scope_key,
    _attachment_target,
    _cleanup_expired_attachments,
    _consume_attachment_context,
    _delete_attachment,
    delete_chat_attachment,
    upload_chat_attachment,
)
from backend.domains.agent.routes.workflow import get_agent_workflow
from backend.domains.agent.routes.confirmations import (
    _action_has_uncertain_effect,
    _action_scope,
    _execute_first_party_confirmation_in_worker,
    _execute_governed_tool,
    _heartbeat_claimed_confirmation,
    _minimum_role_allows,
    _raise_confirmation_error,
    _validated_action_id,
    cancel_agent_action,
    confirm_agent_action,
    get_agent_confirmation,
    get_agent_replay,
    list_agent_capability_audit,
    list_agent_confirmations,
)
from backend.domains.agent.routes.sessions import (
    delete_chat_session,
    get_chat_session,
    rewind_chat_session,
)
from backend.domains.agent.routes.misc import (
    cancel_running_agent_stream,
    list_context_sources,
    list_internal_context_sources,
    model_reliability,
    record_chat_feedback,
    resume_agent_stream,
)
from backend.domains.agent.routes.chat_route import chat_endpoint
from backend.domains.agent.routes.state import cfg
from backend.services.agent_cancellation import (
    bind_stream as bind_agent_stream,
    cancel_stream as cancel_agent_stream,
    create_cancel_token,
    release as release_agent_turn,
)
from backend.services.agent_quality_telemetry import record_quality_signal
from backend.services.agent_replay import record_event as record_replay_event
from backend.services.agent_stream_journal import replay as replay_stream_events
from backend.services.agent_stream_journal import scope_digest
from backend.services.agent_stream_protocol import protocolize_stream
from backend.services.turn_idempotency import claim as claim_turn
from backend.services.turn_idempotency import finish as finish_turn
from backend.services.workspace_service import WorkspaceContext


_COMPATIBILITY_TARGETS: dict[str, tuple[str, ...]] = {
    "AsyncSqliteSaver": (
        "backend.domains.agent.routes.sessions",
        "backend.domains.agent.routes.chat_stream_updates",
    ),
    "CONFIRMED_ACTION_TIMEOUT_SECONDS": ("backend.domains.agent.routes.confirmations",),
    "_attachment_context": ("backend.domains.agent.routes.attachments",),
    "_consume_attachment_context": ("backend.domains.agent.routes.chat_route",),
    "_explicit_brain_write_tool_names": (
        "backend.domains.agent.routes.shared",
        "backend.domains.agent.routes.chat_route",
    ),
    "_prepare_index_title_replacements": ("backend.domains.agent.routes.chat_stream",),
    "_vault_scope": (
        "backend.domains.agent.routes.attachments",
        "backend.domains.agent.routes.confirmations",
        "backend.domains.agent.routes.sessions",
        "backend.domains.agent.routes.misc",
        "backend.domains.agent.routes.chat_route",
    ),
    "bind_agent_stream": ("backend.domains.agent.routes.chat_route",),
    "build_agent_turn_plan": ("backend.domains.agent.routes.chat_route",),
    "cancel_agent_stream": ("backend.domains.agent.routes.misc",),
    "cancel_scope_confirmations": ("backend.domains.agent.routes.sessions",),
    "cfg": (
        "backend.domains.agent.routes.state",
        "backend.domains.agent.routes.sessions",
        "backend.domains.agent.routes.chat_route",
    ),
    "claim_turn": ("backend.domains.agent.routes.chat_route",),
    "create_agent_workflow": ("backend.domains.agent.routes.workflow",),
    "create_cancel_token": ("backend.domains.agent.routes.chat_route",),
    "create_checkpoint": ("backend.domains.agent.routes.sessions",),
    "execute_confirmed_action": ("backend.domains.agent.routes.confirmations",),
    "finish_turn": (
        "backend.domains.agent.routes.chat_route",
        "backend.domains.agent.routes.chat_stream_errors",
    ),
    "get_agent_workflow": ("backend.domains.agent.routes.chat_route",),
    "prepare_agent_runtime": (
        "backend.domains.agent.routes.workflow",
        "backend.domains.agent.routes.confirmations",
    ),
    "protocolize_stream": ("backend.domains.agent.routes.chat_route",),
    "record_quality_signal": (
        "backend.domains.agent.routes.misc",
        "backend.domains.agent.routes.chat_stream_errors",
    ),
    "record_replay_event": ("backend.domains.agent.routes.chat_stream_errors",),
    "release_agent_turn": (
        "backend.domains.agent.routes.chat_route",
        "backend.domains.agent.routes.chat_stream_errors",
    ),
    "replace_reference_ids_in_titles": ("backend.domains.agent.routes.shared",),
    "replay_stream_events": ("backend.domains.agent.routes.misc",),
    "scope_digest": ("backend.domains.agent.routes.misc",),
}


class _CompatibilityModule(ModuleType):
    """Propagate explicit historical monkeypatch seams to their new owners."""

    def __setattr__(self, name: str, value: Any) -> None:
        super().__setattr__(name, value)
        for module_name in _COMPATIBILITY_TARGETS.get(name, ()):
            target = sys.modules.get(module_name)
            if target is not None:
                setattr(target, name, value)


sys.modules[__name__].__class__ = _CompatibilityModule


__all__ = [
    name
    for name in globals()
    if not name.startswith("__") and name not in {"Any", "ModuleType", "sys"}
]
