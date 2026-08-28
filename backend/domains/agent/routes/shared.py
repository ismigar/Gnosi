import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, cast

from fastapi import HTTPException
from langgraph.errors import GraphRecursionError

from backend.agent.action_confirmations import confirmation_event
from backend.agent.factory import _explicit_brain_write_tool_names
from backend.agent.gnosi_tools import replace_reference_ids_in_titles
from backend.domains.agent.routes.contracts import IDENTIFIER_RE, SKILL_IDENTIFIER_RE
from backend.services.context_vars import get_active_vault_path
from backend.services.workspace_service import WorkspaceContext


class _InvokableTool(Protocol):
    def invoke(self, arguments: Dict[str, Any]) -> Any: ...


def _agent_stream_error_code(error: BaseException) -> Optional[str]:
    """Return a stable client code for locally enforced stream failures."""
    if isinstance(error, TimeoutError):
        return "agent_turn_timeout"
    if isinstance(error, GraphRecursionError):
        return "agent_loop_exhausted"
    return None


def _validated_identifier(value: str, label: str) -> str:
    candidate = (value or "").strip()
    if not IDENTIFIER_RE.fullmatch(candidate):
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return candidate


def _notebook_conversation_scope(
    notebook_id: Optional[str],
    workspace_context: WorkspaceContext,
    *,
    mutation: str = "read",
) -> Optional[Dict[str, Any]]:
    # Direct endpoint calls receive FastAPI's Query object as the Python
    # default. Only an actual non-empty string selects notebook semantics.
    if not isinstance(notebook_id, str) or not notebook_id.strip():
        return None
    from backend.services import notebook_service

    notebook = notebook_service.authorize(str(notebook_id), workspace_context, action="read")
    if mutation == "rewind" and notebook["conversation_mode"] == "shared":
        raise HTTPException(
            status_code=409,
            detail="Shared notebook conversations are append-only.",
        )
    if mutation == "clear" and (
        notebook["conversation_mode"] == "shared"
        and notebook["owner_user_id"] != workspace_context.user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Only the notebook creator can clear the shared conversation.",
        )
    return {
        "notebook": notebook,
        "principal": notebook_service.conversation_principal(notebook, workspace_context.user_id),
        "session_id": notebook_service.conversation_session_id(notebook),
    }


def _validated_skill_ids(values: Optional[List[str]]) -> Optional[List[str]]:
    """Validate and deduplicate optional per-turn skill activations."""
    if values is None:
        return None
    result = []
    seen = set()
    for value in values:
        candidate = (value or "").strip()
        if not SKILL_IDENTIFIER_RE.fullmatch(candidate):
            raise HTTPException(status_code=422, detail="Invalid skill ID")
        if candidate not in seen:
            seen.add(candidate)
            result.append(candidate)
    return result


def _vault_scope() -> tuple[Path, str]:
    vault = Path(get_active_vault_path()).resolve()
    digest = hashlib.sha256(str(vault).encode("utf-8")).hexdigest()[:20]
    return vault, digest


def _tool_stream_event(
    event_type: str,
    tool_name: Optional[str],
    node_name: str,
    metadata: Optional[Dict[str, Any]] = None,
    trace_id: Optional[str] = None,
) -> str:
    """Serialize public tool lifecycle metadata without arguments or results."""
    payload: Dict[str, Any] = {
        "type": event_type,
        "tool": tool_name,
        "node": node_name,
    }
    if trace_id:
        payload["trace_id"] = trace_id
    if metadata:
        payload.update(
            {
                "tool_id": metadata.get("id"),
                "skill_ids": list(metadata.get("skill_ids") or []),
                "effects": list(metadata.get("effects") or []),
            }
        )
        if "awaiting_confirmation" in metadata:
            payload["awaiting_confirmation"] = bool(metadata["awaiting_confirmation"])
    return json.dumps(payload) + "\n"


def _message_text(content: Any) -> str:
    """Normalize provider-specific structured content into renderable text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                block_type = str(block.get("type") or "").lower()
                if block_type in {"reasoning", "thinking", "analysis"}:
                    continue
                value = block.get("text")
                if value is None and block_type in {"", "text", "output_text"}:
                    value = block.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return "\n".join(part for part in parts if part)
    if content is None:
        return ""
    return str(content)


def _prepare_index_title_replacements(message: str) -> Optional[Dict[str, Any]]:
    """Prepare the deterministic confirmation for index title replacements."""
    normalized = message.casefold()
    if (
        "replace_reference_ids_in_titles" not in _explicit_brain_write_tool_names(message)
        or "projectes" not in normalized
        or ("àrees" not in normalized and "areas" not in normalized)
    ):
        return None
    result = cast(_InvokableTool, replace_reference_ids_in_titles).invoke(
        {
            "source_table_id_or_name": "Cervell digital",
            "reference_tables": {
                "Projecte": "Projectes",
                "Àrea": "Àrees",
            },
        }
    )
    event = confirmation_event(result)
    if event:
        return cast(Dict[str, Any], event)
    try:
        payload = json.loads(result)
    except (TypeError, ValueError):
        payload = {}
    detail = str(payload.get("error") or "").strip()
    return cast(
        Dict[str, Any],
        {
            "type": "error",
            "content": detail or "The bulk title update could not be prepared.",
        },
    )
