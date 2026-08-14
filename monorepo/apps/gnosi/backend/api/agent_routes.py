import asyncio
import copy
import hashlib
import json
import logging
import os
import re
import time
import uuid
import weakref
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.base import create_checkpoint
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.errors import GraphRecursionError
from pydantic import BaseModel, Field, model_validator

from backend.agent.action_confirmations import (
    _descriptor_digest,
    bind_confirmation_context,
    cancel_confirmation,
    cancel_scope_confirmations,
    claim_confirmation,
    confirmation_context,
    confirmation_event,
    finish_confirmation,
    get_confirmation_status,
    heartbeat_confirmation,
    list_confirmations,
    reset_confirmation_context,
)
from backend.agent.factory import (
    _explicit_brain_write_tool_names,
    create_agent_workflow,
    prepare_agent_runtime,
)
from backend.agent.gnosi_tools import (
    ActionConflictError,
    execute_confirmed_action,
    replace_reference_ids_in_titles,
)
from backend.agent.model_router import record_llm_usage, usage_from_message
from backend.agent.model_reliability import (
    blames_the_model, model_evidence, record_failure, reliability_report,
)
from backend.config.app_config import load_params
from backend.services.capability_audit import (
    list_capability_events,
    record_capability_event,
)
from backend.services.context_vars import get_active_vault_path
from backend.services.workspace_service import WorkspaceContext, require_role
from backend.utils.errors import safe_error_detail

cfg = load_params()

log = logging.getLogger(__name__)
router = APIRouter()


# One line per reason, in the user's language. The taxonomy itself (and which
# reasons are the model's fault) lives in `model_reliability`.
FAILURE_MESSAGES = {
    "tool_use_failed": (
        "The model did not call the tools correctly and wrote the call as text. "
        "This is a model limitation, not a tool limitation."
    ),
    "context_length_exceeded": (
        "The conversation exceeds the model's context window. Shorten it or "
        "choose a model with a larger context window."
    ),
    "schema_invalid": "The model did not produce the requested response format.",
    "content_filter": "The provider blocked the response through its content filters.",
    "rate_limit": "Provider request limit reached. Try again later.",
    "insufficient_credit": (
        "The provider account does not have enough credit. This is not a model problem."
    ),
    "auth": "Invalid provider credentials. Check them in Settings → AI.",
    "not_found": "The provider does not recognize this model.",
    "timeout": "The provider did not respond in time. Try again.",
    "server_error": "Provider error. Try again later.",
}


class MentionRef(BaseModel):
    type: str = Field(max_length=32)
    id: str = Field(max_length=256)
    label: Optional[str] = Field(default=None, max_length=256)

class AttachmentRef(BaseModel):
    name: str = Field(max_length=256)
    size: int = 0
    type: str = Field(default="", max_length=128)
    path: str = Field(max_length=512)


class TurnContextRef(BaseModel):
    """One read-only Gnosi source supplied by current module UI state."""

    id: str = Field(max_length=128)
    type: str = Field(default="internal", max_length=32)
    ref: str = Field(max_length=64)
    label: Optional[str] = Field(default=None, max_length=256)
    scope: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_context_source(self):
        from backend.agent.internal_sources import normalize_internal_scope

        source_type = self.type.strip().lower()
        source_ref = self.ref.strip()
        if source_type == "internal":
            self.type = source_type
            self.ref = source_ref.lower()
            self.scope = normalize_internal_scope(self.ref, self.scope)
            return self
        if source_type not in {"page", "table", "database", "vault"}:
            raise ValueError(
                "Turn context accepts read-only Gnosi module sources only."
            )
        if not source_ref:
            raise ValueError("Turn context source reference cannot be empty.")
        self.type = source_type
        self.ref = source_ref
        if source_type == "table":
            view_id = str(self.scope.get("view_id") or "").strip()[:64]
            view_name = str(self.scope.get("view_name") or "").strip()[:256]
            self.scope = {
                key: value
                for key, value in {
                    "view_id": view_id,
                    "view_name": view_name,
                }.items()
                if value
            }
        else:
            self.scope = {}
        return self

class ChatRequest(BaseModel):
    message: str = Field(max_length=100_000)
    agent_id: str = "gnosy" # Default agent
    session_id: str = "default"
    history: List[Dict[str, Any]] = Field(default_factory=list)
    llm_mode: str = "agent_default"  # auto | manual | agent_default
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    mentions: List[MentionRef] = Field(default_factory=list, max_length=20)
    attachments: List[AttachmentRef] = Field(default_factory=list, max_length=8)
    active_skill_ids: Optional[List[str]] = Field(default=None, max_length=64)
    context_refs: List[TurnContextRef] = Field(default_factory=list, max_length=8)
    turn_id: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
    )

    @model_validator(mode="before")
    @classmethod
    def reject_client_confirmation_grants(cls, value):
        """Reject the removed client-side approval bypass explicitly."""
        if isinstance(value, dict) and "confirmed_tool_ids" in value:
            raise ValueError(
                "Client-provided tool confirmations are not accepted."
            )
        return value


class ChatRewindRequest(BaseModel):
    """Select the canonical turn boundary that should become the new tail."""

    before_turn_id: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    keep_messages: int = Field(default=0, ge=0, le=200)


class AttachmentDeleteRequest(BaseModel):
    path: str = Field(max_length=512)
    agent_id: str = Field(max_length=128)
    session_id: str = Field(max_length=128)


class ActionConfirmationRequest(BaseModel):
    agent_id: str = Field(max_length=128)
    session_id: str = Field(max_length=128)


IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
ACTION_ID_RE = re.compile(r"^[a-f0-9]{32}$")
SKILL_IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,191}$")
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
MAX_ATTACHMENT_TEXT = 20_000
MAX_ATTACHMENT_CONTEXT = 40_000
MAX_PDF_PAGES = 50
ATTACHMENT_EXTRACTION_SECONDS = 5
ATTACHMENT_MAX_AGE_SECONDS = 24 * 60 * 60
TURN_TIMEOUT_SECONDS = 120
TURN_LOCK_TIMEOUT_SECONDS = 5
CONFIRMED_ACTION_TIMEOUT_SECONDS = 120
CONFIRMATION_HEARTBEAT_SECONDS = 30
CHAT_ATTACHMENT_TYPES = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
    ".xml", ".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".pdf",
}
_THREAD_LOCKS: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()


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


def _chat_thread_id(
    *,
    vault_scope: str,
    workspace_id: str,
    user_id: str,
    agent_id: str,
    session_id: str,
) -> str:
    """Return a tenant- and user-isolated LangGraph thread identifier."""
    payload = ":".join((
        vault_scope,
        workspace_id,
        user_id,
        agent_id,
        session_id,
    ))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _checkpoint_key(
    *,
    vault_scope: str,
    workspace_id: str,
    user_id: str,
    agent_id: str,
) -> str:
    """Return the isolated checkpoint database key for one agent identity."""
    payload = ":".join((vault_scope, workspace_id, user_id, agent_id))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


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


def _attachment_scope_key(
    vault_scope: str,
    workspace_id: str,
    user_id: str,
    agent_id: str,
    session_id: str,
) -> str:
    payload = ":".join(
        (vault_scope, workspace_id, user_id, agent_id, session_id),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _attachment_root(vault: Path, scope_key: Optional[str] = None) -> Path:
    root = (vault / ".gnosi" / "chat-attachments").resolve()
    if scope_key:
        root = (root / scope_key).resolve()
    if root != vault and vault not in root.parents:
        raise HTTPException(status_code=400, detail="Invalid attachment directory")
    return root


def _attachment_target(vault: Path, relative_path: str, scope_key: str) -> Path:
    root = _attachment_root(vault, scope_key)
    relative = Path(relative_path)
    target = (vault / relative).resolve()
    if target == vault or vault not in target.parents or root not in target.parents:
        raise HTTPException(status_code=422, detail="Invalid attachment path")
    return target


def _delete_attachment(vault: Path, relative_path: str, scope_key: str) -> None:
    target = _attachment_target(vault, relative_path, scope_key)
    if target.is_file():
        target.unlink(missing_ok=True)


def _cleanup_expired_attachments(vault: Path, scope_key: str) -> None:
    """Remove expired uploads only within the authenticated request scope."""
    root = _attachment_root(vault, scope_key)
    if not root.exists():
        return
    cutoff = time.time() - ATTACHMENT_MAX_AGE_SECONDS
    deadline = time.monotonic() + 0.05
    for index, item in enumerate(root.iterdir()):
        if index >= 256 or time.monotonic() >= deadline:
            break
        try:
            if item.is_file() and item.stat().st_mtime < cutoff:
                item.unlink(missing_ok=True)
        except OSError:
            continue


def _attachment_context(
    vault: Path,
    refs: List[AttachmentRef],
    scope_key: str,
) -> str:
    sections = []
    remaining_total = MAX_ATTACHMENT_CONTEXT
    deadline = time.monotonic() + ATTACHMENT_EXTRACTION_SECONDS
    for ref in refs:
        if remaining_total <= 0 or time.monotonic() >= deadline:
            break
        target = _attachment_target(vault, ref.path, scope_key)
        if not target.is_file() or target.stat().st_size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=422, detail="Attachment is missing or too large")

        suffix = target.suffix.lower()
        text = ""
        if suffix == ".pdf":
            try:
                from pypdf import PdfReader
                chunks = []
                extracted = 0
                for page_index, page in enumerate(PdfReader(str(target)).pages):
                    if page_index >= MAX_PDF_PAGES:
                        break
                    if extracted >= min(MAX_ATTACHMENT_TEXT, remaining_total):
                        break
                    if time.monotonic() >= deadline:
                        break
                    chunk = page.extract_text() or ""
                    chunks.append(chunk[: min(MAX_ATTACHMENT_TEXT, remaining_total) - extracted])
                    extracted += len(chunks[-1])
                text = "\n".join(chunks)
            except Exception as exc:
                log.warning("Could not extract chat PDF attachment %s: %s", target.name, exc)
        else:
            with target.open("r", encoding="utf-8", errors="replace") as handle:
                text = handle.read(min(MAX_ATTACHMENT_TEXT, remaining_total) + 1)

        if text.strip():
            bounded = text[: min(MAX_ATTACHMENT_TEXT, remaining_total)]
            sections.append(f"Attachment: {ref.name}\n{bounded}")
            remaining_total -= len(bounded)
        else:
            sections.append(
                f"Attachment: {ref.name}\n"
                "(No text could be extracted.)"
            )
    return "\n\n".join(sections)


def _consume_attachment_context(
    vault: Path,
    refs: List[AttachmentRef],
    scope_key: str,
) -> str:
    """Extract request-owned attachment context and always remove its files."""
    try:
        return _attachment_context(vault, refs, scope_key)
    finally:
        for attachment in refs:
            try:
                _delete_attachment(vault, attachment.path, scope_key)
            except Exception as cleanup_error:
                log.warning(
                    "Could not remove chat attachment %s: %s",
                    attachment.path,
                    cleanup_error,
                )


def _tool_stream_event(
    event_type: str,
    tool_name: Optional[str],
    node_name: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Serialize public tool lifecycle metadata without arguments or results."""
    payload = {
        "type": event_type,
        "tool": tool_name,
        "node": node_name,
    }
    if metadata:
        payload.update({
            "tool_id": metadata.get("id"),
            "skill_ids": list(metadata.get("skill_ids") or []),
            "effects": list(metadata.get("effects") or []),
        })
        if "awaiting_confirmation" in metadata:
            payload["awaiting_confirmation"] = bool(
                metadata["awaiting_confirmation"]
            )
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
        "replace_reference_ids_in_titles"
        not in _explicit_brain_write_tool_names(message)
        or "projectes" not in normalized
        or ("àrees" not in normalized and "areas" not in normalized)
    ):
        return None
    result = replace_reference_ids_in_titles.invoke({
        "source_table_id_or_name": "Cervell digital",
        "reference_tables": {
            "Projecte": "Projectes",
            "Àrea": "Àrees",
        },
    })
    event = confirmation_event(result)
    if event:
        return event
    try:
        payload = json.loads(result)
    except (TypeError, ValueError):
        payload = {}
    detail = str(payload.get("error") or "").strip()
    return {
        "type": "error",
        "content": detail or "The bulk title update could not be prepared.",
    }


def _public_checkpoint_message_entries(
    stored_messages: List[Any],
) -> List[tuple[int, Dict[str, str]]]:
    """Return bounded public messages together with their raw positions."""
    entries = []
    current_turn_id = ""
    start = max(0, len(stored_messages) - 200)
    for raw_index, message in enumerate(stored_messages[start:], start=start):
        role = getattr(message, "type", "")
        if role not in {"human", "ai"}:
            continue
        if role == "ai" and getattr(message, "tool_calls", None):
            continue
        if role == "human":
            current_turn_id = str(
                getattr(message, "additional_kwargs", {}).get(
                    "gnosi_turn_id",
                    "",
                )
                or ""
            )
        visible_content = (
            getattr(message, "additional_kwargs", {}).get(
                "gnosi_visible_content",
            )
            if role == "human"
            else None
        )
        content = (
            str(visible_content)
            if visible_content is not None
            else _message_text(getattr(message, "content", ""))
        )
        if role == "human" and visible_content is None:
            marker_positions = [
                position
                for marker in (
                    "\n\nAttachment:",
                    "\n\nSelected mentions context:",
                )
                if (position := content.find(marker)) >= 0
            ]
            if marker_positions:
                content = content[:min(marker_positions)]
        if content.strip():
            public_message = {
                "role": "user" if role == "human" else "assistant",
                "content": content,
            }
            if current_turn_id:
                public_message["turn_id"] = current_turn_id
            entries.append((raw_index, public_message))
    return entries


def _public_checkpoint_messages(stored_messages: List[Any]) -> List[Dict[str, str]]:
    """Serialize only user-visible transcript messages from checkpoint state."""
    return [
        message
        for _raw_index, message in _public_checkpoint_message_entries(
            stored_messages,
        )
    ]


def _rewound_checkpoint_messages(
    stored_messages: List[Any],
    *,
    before_turn_id: Optional[str],
    keep_messages: int,
) -> List[Any]:
    """Return a prefix ending at a complete canonical conversation turn."""
    entries = _public_checkpoint_message_entries(stored_messages)
    if before_turn_id:
        for raw_index, message in entries:
            if (
                message.get("role") == "user"
                and message.get("turn_id") == before_turn_id
            ):
                return list(stored_messages[:raw_index])
        raise ValueError("The requested conversation turn is unavailable.")

    retained_count = min(max(0, keep_messages), len(entries))
    while (
        retained_count > 0
        and entries[retained_count - 1][1].get("role") != "assistant"
    ):
        retained_count -= 1
    if retained_count == 0:
        return []
    cutoff = entries[retained_count - 1][0]
    return list(stored_messages[:cutoff + 1])


def _thread_lock(thread_id: str) -> asyncio.Lock:
    lock = _THREAD_LOCKS.get(thread_id)
    if lock is None:
        lock = asyncio.Lock()
        _THREAD_LOCKS[thread_id] = lock
    return lock


def _ai_runtime_revision(ai_cfg: Dict[str, Any]) -> str:
    """Hash model/provider state that is embedded in a cached workflow."""
    providers = {}
    for provider_id, raw in dict((ai_cfg or {}).get("providers") or {}).items():
        config = dict(raw or {}) if isinstance(raw, dict) else {}
        providers[str(provider_id)] = {
            key: config.get(key)
            for key in ("enabled", "base_url", "credential_ref")
            if key in config
        }
    payload = {
        "models": list((ai_cfg or {}).get("models") or []),
        "providers": providers,
        "disconnected_providers": sorted(
            str(item)
            for item in ((ai_cfg or {}).get("disconnected_providers") or [])
        ),
    }
    return hashlib.sha256(
        json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()[:16]


class SessionBusyError(RuntimeError):
    """Raised when another turn still owns the same session."""


@asynccontextmanager
async def _acquire_turn_lock(lock: asyncio.Lock):
    try:
        await asyncio.wait_for(lock.acquire(), timeout=TURN_LOCK_TIMEOUT_SECONDS)
    except TimeoutError as error:
        raise SessionBusyError("chat_session_busy") from error
    try:
        yield
    finally:
        lock.release()

async def get_agent_workflow(
    request: Request,
    agent_id: str,
    llm_mode: str = "agent_default",
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    user_message: str = "",
    vault_scope: str = "",
    vault_path: Optional[Path] = None,
    active_skill_ids: Optional[List[str]] = None,
    turn_context_refs: Optional[List[Dict[str, Any]]] = None,
):
    """
    Helper to get or build the agent workflow for a specific ID.
    Caches the StateGraph in app.state.agent_cache.
    """
    use_cache = llm_mode == "agent_default" and not llm_provider and not llm_model

    if not hasattr(request.app.state, "agent_cache"):
        request.app.state.agent_cache = {}

    mcp_client = getattr(request.app.state, "mcp_client", None)
    mcp_ready = mcp_client is not None
    tools_list = []
    if mcp_ready:
        tools_list = getattr(request.app.state, "tools_list", [])
        if not tools_list:
            tools_list = await mcp_client.get_all_tools()
            request.app.state.tools_list = tools_list
    else:
        # Degrade gracefully while MCP initializes: chat still works without MCP tools.
        log.warning("MCP client not ready, creating workflow without MCP tools")
        use_cache = False

    from backend.services.mcp_tool_contributions import (
        refresh_mcp_tool_contributions,
    )

    refresh_mcp_tool_contributions(tools_list, mcp_client)
    ai_cfg, agent_data, runtime_capabilities = prepare_agent_runtime(
        agent_id,
        vault_path=vault_path,
        active_skill_ids=active_skill_ids,
    )
    if turn_context_refs:
        from backend.agent.agent_context import (
            expand_dashboard_context_refs,
            merge_context_refs,
        )

        agent_data = dict(agent_data or {})
        agent_data["context_refs"] = expand_dashboard_context_refs(
            merge_context_refs(
                agent_data.get("context_refs") or [],
                turn_context_refs,
            ),
        )
    runtime_active_ids = list(
        getattr(runtime_capabilities, "active_skill_ids", ()) or ()
    )
    catalog_revision = str(
        getattr(runtime_capabilities, "catalog_revision", "") or ""
    )
    agent_revision = hashlib.sha256(
        json.dumps(
            agent_data or {},
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()[:16]
    runtime_revision = hashlib.sha256(
        json.dumps(
            {
                "active_skill_ids": runtime_active_ids,
                "catalog_revision": catalog_revision,
                "ai_runtime_revision": _ai_runtime_revision(ai_cfg),
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:16]
    cache_key = (
        f"{vault_scope}:{agent_id}:{agent_revision}:{runtime_revision}"
    )
    if use_cache and cache_key in request.app.state.agent_cache:
        cached = request.app.state.agent_cache[cache_key]
        return cached["workflow"], cached.get("llm_selection", {})

    workflow, llm_selection = await create_agent_workflow(
        tools_list,
        mcp_client,
        agent_id=agent_id,
        llm_mode=llm_mode,
        llm_provider=llm_provider,
        llm_model=llm_model,
        user_message=user_message,
        timeout=60,
        active_skill_ids=active_skill_ids,
        vault_path=vault_path,
        prepared_ai_cfg=ai_cfg,
        prepared_agent_data=agent_data,
        runtime_capabilities=runtime_capabilities,
    )

    if workflow is None:
        if llm_mode == "agent_default":
            raise HTTPException(status_code=503, detail={"code": "agent_model_unavailable"})
        raise HTTPException(status_code=503, detail="No LLM provider available")

    if use_cache:
        cache_prefix = f"{vault_scope}:{agent_id}:"
        for stale_key in tuple(request.app.state.agent_cache):
            if stale_key.startswith(cache_prefix) and stale_key != cache_key:
                request.app.state.agent_cache.pop(stale_key, None)
        request.app.state.agent_cache[cache_key] = {
            "workflow": workflow,
            "llm_selection": llm_selection,
        }

    return workflow, llm_selection


@router.post("/chat/attachments")
async def upload_chat_attachment(
    file: UploadFile = File(...),
    agent_id: str = Form(...),
    session_id: str = Form(...),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Store one bounded chat attachment inside the active Vault."""
    vault, vault_scope = _vault_scope()
    scope_key = _attachment_scope_key(
        vault_scope,
        workspace_context.workspace_id,
        workspace_context.user_id,
        _validated_identifier(agent_id, "agent_id"),
        _validated_identifier(session_id, "session_id"),
    )
    _cleanup_expired_attachments(vault, scope_key)
    original_name = Path(file.filename or "attachment").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in CHAT_ATTACHMENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported chat attachment type")
    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if not content:
        raise HTTPException(status_code=422, detail="Chat attachment is empty")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Chat attachment exceeds 15 MB")

    root = _attachment_root(vault, scope_key)
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{uuid.uuid4().hex}{suffix}"
    target.write_bytes(content)
    return {
        "name": original_name,
        "size": len(content),
        "type": file.content_type or "",
        "path": str(target.relative_to(vault)),
    }


@router.delete("/chat/attachments")
async def delete_chat_attachment(
    delete_req: AttachmentDeleteRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Delete an abandoned chat upload from the active Vault."""
    vault, vault_scope = _vault_scope()
    scope_key = _attachment_scope_key(
        vault_scope,
        workspace_context.workspace_id,
        workspace_context.user_id,
        _validated_identifier(delete_req.agent_id, "agent_id"),
        _validated_identifier(delete_req.session_id, "session_id"),
    )
    _delete_attachment(vault, delete_req.path, scope_key)
    return {"deleted": True}


def _action_scope(
    payload: ActionConfirmationRequest,
    workspace_context: WorkspaceContext,
) -> Dict[str, str]:
    """Builds the exact authenticated scope used by pending actions."""
    _vault, vault_scope = _vault_scope()
    return {
        "vault_scope": vault_scope,
        "workspace_id": workspace_context.workspace_id,
        "user_id": workspace_context.user_id,
        "role": workspace_context.role,
        "agent_id": _validated_identifier(payload.agent_id, "agent_id"),
        "session_id": _validated_identifier(payload.session_id, "session_id"),
    }


def _validated_action_id(action_id: str) -> str:
    candidate = str(action_id or "").strip()
    if not ACTION_ID_RE.fullmatch(candidate):
        raise HTTPException(status_code=422, detail="Invalid confirmation ID")
    return candidate


def _raise_confirmation_error(error: Exception) -> None:
    if isinstance(error, LookupError):
        raise HTTPException(
            status_code=404,
            detail={"code": "confirmation_not_found"},
        )
    if isinstance(error, PermissionError):
        raise HTTPException(
            status_code=403,
            detail={"code": "confirmation_scope_mismatch"},
        )
    if isinstance(error, TimeoutError):
        raise HTTPException(
            status_code=410,
            detail={"code": "confirmation_expired"},
        )
    if isinstance(error, RuntimeError):
        raise HTTPException(
            status_code=409,
            detail={"code": "confirmation_unavailable"},
        )
    raise error


def _minimum_role_allows(current_role: str, required_role: str) -> bool:
    weights = {"viewer": 0, "editor": 1, "admin": 2, "owner": 3}
    return weights.get(current_role, -1) >= weights.get(required_role, 0)


async def _execute_governed_tool(
    arguments: Dict[str, Any],
    *,
    scope: Dict[str, str],
    vault: Path,
) -> Dict[str, Any]:
    """Re-resolve and execute one exact assigned `confirmation=always` tool."""
    active_skill_ids = list(arguments.get("active_skill_ids") or [])
    _ai_cfg, agent_data, runtime = prepare_agent_runtime(
        scope["agent_id"],
        vault_path=vault,
        active_skill_ids=active_skill_ids,
    )
    if not agent_data or runtime is None:
        raise PermissionError("The agent runtime is unavailable.")

    tool_id = str(arguments.get("tool_id") or "")
    tool_name = str(arguments.get("tool_name") or "")
    descriptor = None
    handler = None
    for current_descriptor, current_handler in zip(
        getattr(runtime, "tool_descriptors", ()) or (),
        getattr(runtime, "tools", ()) or (),
    ):
        if str(getattr(current_descriptor, "id", "") or "") == tool_id:
            descriptor = current_descriptor
            handler = current_handler
            break
    if descriptor is None or handler is None:
        raise PermissionError("The governed tool is no longer assigned.")
    visible_name = str(
        getattr(handler, "name", "")
        or getattr(handler, "__name__", "")
        or ""
    )
    if visible_name != tool_name:
        raise PermissionError("The governed tool identity changed.")
    confirmation = str(
        getattr(getattr(descriptor, "confirmation", ""), "value", "")
        or getattr(descriptor, "confirmation", "")
    )
    if confirmation != "always":
        raise PermissionError("The governed tool no longer requires this approval.")
    if _descriptor_digest(descriptor) != str(
        arguments.get("descriptor_digest") or ""
    ):
        raise ActionConflictError("The governed tool changed after the preview.")
    if not _minimum_role_allows(
        scope["role"],
        str(getattr(descriptor, "minimum_role", "viewer") or "viewer"),
    ):
        raise PermissionError("The current role cannot execute this tool.")

    call_arguments = dict(arguments.get("tool_arguments") or {})
    started = time.monotonic()
    effects = [
        str(getattr(effect, "value", effect))
        for effect in (getattr(descriptor, "effects", None) or [])
    ]
    try:
        if callable(getattr(handler, "ainvoke", None)):
            result = await handler.ainvoke(call_arguments)
        elif callable(getattr(handler, "invoke", None)):
            result = await asyncio.to_thread(handler.invoke, call_arguments)
        elif asyncio.iscoroutinefunction(handler):
            result = await handler(**call_arguments)
        else:
            result = await asyncio.to_thread(handler, **call_arguments)
    except Exception as error:
        await asyncio.to_thread(
            record_capability_event,
            scope,
            tool_id=tool_id,
            tool_name=tool_name,
            effects=effects,
            status="failed",
            argument_keys=list(call_arguments),
            error_code=type(error).__name__,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        raise
    await asyncio.to_thread(
        record_capability_event,
        scope,
        tool_id=tool_id,
        tool_name=tool_name,
        effects=effects,
        status="completed",
        argument_keys=list(call_arguments),
        result_kind=type(result).__name__,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
        except (TypeError, ValueError):
            return {"status": "completed", "result": result[:2_000]}
        return parsed if isinstance(parsed, dict) else {
            "status": "completed",
            "result": parsed,
        }
    return {"status": "completed"}


def _action_has_uncertain_effect(action: str, arguments: Dict[str, Any]) -> bool:
    if action in {
        "archive_mail",
        "change_schema",
        "create_calendar_event",
        "delete_contact",
        "delete_page",
        "delete_table",
        "empty_trash",
        "invite_attendees",
        "move_mail",
        "restore_page_version",
        "save_mail_draft",
        "send_mail",
    }:
        return True
    if action == "governed_tool":
        return bool({
            "code_execution",
            "destructive",
            "external_write",
        }.intersection(arguments.get("effects") or []))
    return False


async def _heartbeat_claimed_confirmation(action_id: str) -> None:
    """Keep a live execution lease from being mistaken for an abandoned call."""
    while True:
        await asyncio.sleep(CONFIRMATION_HEARTBEAT_SECONDS)
        alive = await asyncio.to_thread(heartbeat_confirmation, action_id)
        if not alive:
            return


def _execute_first_party_confirmation_in_worker(
    action: str,
    arguments: Dict[str, Any],
    *,
    workspace_id: str,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    """Run blocking provider/filesystem handlers outside the server event loop."""
    return asyncio.run(execute_confirmed_action(
        action,
        arguments,
        workspace_id=workspace_id,
        background_tasks=background_tasks,
    ))


@router.get("/chat/confirmations")
async def list_agent_confirmations(
    agent_id: str = Query(..., max_length=128),
    session_id: str = Query(..., max_length=128),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Return resumable public confirmation cards for one exact chat scope."""
    scope = _action_scope(
        ActionConfirmationRequest(agent_id=agent_id, session_id=session_id),
        workspace_context,
    )
    records = await asyncio.to_thread(list_confirmations, scope)
    return {"confirmations": records}


@router.get("/chat/capability-audit")
async def list_agent_capability_audit(
    agent_id: str = Query(..., max_length=128),
    session_id: str = Query(..., max_length=128),
    limit: int = Query(100, ge=1, le=500),
    tool_id: Optional[str] = Query(default=None, max_length=256),
    status: Optional[str] = Query(default=None, max_length=64),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Return metadata-only governed tool events for one exact chat scope."""
    scope = _action_scope(
        ActionConfirmationRequest(agent_id=agent_id, session_id=session_id),
        workspace_context,
    )
    records = await asyncio.to_thread(
        list_capability_events,
        scope,
        limit=limit,
        tool_id=tool_id,
        status=status,
    )
    return {"events": records}


@router.get("/chat/confirmations/{action_id}")
async def get_agent_confirmation(
    action_id: str,
    agent_id: str = Query(..., max_length=128),
    session_id: str = Query(..., max_length=128),
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Return one public confirmation status for transport reconciliation."""
    safe_action_id = _validated_action_id(action_id)
    scope = _action_scope(
        ActionConfirmationRequest(agent_id=agent_id, session_id=session_id),
        workspace_context,
    )
    try:
        return await asyncio.to_thread(
            get_confirmation_status,
            safe_action_id,
            scope,
        )
    except Exception as error:
        _raise_confirmation_error(error)


@router.post("/chat/confirmations/{action_id}/confirm")
async def confirm_agent_action(
    action_id: str,
    payload: ActionConfirmationRequest,
    background_tasks: BackgroundTasks,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Claims and executes one scope-bound pending agent action exactly once."""
    safe_action_id = _validated_action_id(action_id)
    scope = _action_scope(payload, workspace_context)
    try:
        pending = await asyncio.to_thread(
            claim_confirmation,
            safe_action_id,
            scope,
        )
    except Exception as error:
        _raise_confirmation_error(error)

    admin_actions = {"delete_table", "empty_trash"}
    if pending["action"] in admin_actions and workspace_context.role not in {
        "owner",
        "admin",
    }:
        await asyncio.to_thread(
            finish_confirmation,
            safe_action_id,
            error="Administrator permission is required.",
        )
        raise HTTPException(
            status_code=403,
            detail={"code": "confirmation_admin_required"},
        )

    heartbeat_task = asyncio.create_task(
        _heartbeat_claimed_confirmation(safe_action_id)
    )
    try:
        try:
            vault, _vault_scope_id = _vault_scope()
            async with asyncio.timeout(CONFIRMED_ACTION_TIMEOUT_SECONDS):
                with confirmation_context(**scope):
                    if pending["action"] == "governed_tool":
                        result = await _execute_governed_tool(
                            pending["arguments"],
                            scope=scope,
                            vault=vault,
                        )
                    else:
                        result = await asyncio.to_thread(
                            _execute_first_party_confirmation_in_worker,
                            pending["action"],
                            pending["arguments"],
                            workspace_id=workspace_context.workspace_id,
                            background_tasks=background_tasks,
                        )
        except HTTPException as error:
            outcome_unknown = (
                error.status_code >= 500
                and _action_has_uncertain_effect(
                    pending["action"],
                    pending["arguments"],
                )
            )
            await asyncio.to_thread(
                finish_confirmation,
                safe_action_id,
                error=(
                    "execution_outcome_unknown"
                    if outcome_unknown
                    else "confirmation_action_rejected"
                ),
                status="outcome_unknown" if outcome_unknown else "failed",
            )
            if outcome_unknown:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "confirmation_outcome_unknown"},
                ) from error
            raise error
        except Exception as error:
            timed_out = isinstance(error, TimeoutError)
            known_precondition_failure = isinstance(
                error,
                (ActionConflictError, LookupError, PermissionError, ValueError),
            )
            outcome_unknown = (
                timed_out
                or (
                    not known_precondition_failure
                    and _action_has_uncertain_effect(
                        pending["action"],
                        pending["arguments"],
                    )
                )
            )
            await asyncio.to_thread(
                finish_confirmation,
                safe_action_id,
                error=(
                    "execution_outcome_unknown"
                    if outcome_unknown
                    else "confirmation_action_failed"
                ),
                status="outcome_unknown" if outcome_unknown else "failed",
            )
            if outcome_unknown:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "confirmation_outcome_unknown"},
                )
            status_code = (
                409 if isinstance(error, (LookupError, RuntimeError)) else 500
            )
            raise HTTPException(
                status_code=status_code,
                detail={"code": "confirmation_action_failed"},
            )
    finally:
        heartbeat_task.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat_task

    result_status = (
        str(result.get("status") or "")
        if isinstance(result, dict)
        else ""
    )
    normalized_result_status = result_status.strip().lower()
    if normalized_result_status in {"failed", "error", "failure"}:
        terminal_status = "failed"
    elif normalized_result_status in {"cancelled", "canceled"}:
        terminal_status = "cancelled"
    elif normalized_result_status == "partial":
        terminal_status = "partial"
    elif normalized_result_status in {
        "", "completed", "complete", "success", "succeeded", "created",
        "updated", "deleted", "sent", "restored",
    } and not (isinstance(result, dict) and result.get("error")):
        terminal_status = "completed"
    else:
        terminal_status = "failed"
    await asyncio.to_thread(
        finish_confirmation,
        safe_action_id,
        result=result,
        status=terminal_status,
    )
    return {
        "status": terminal_status,
        "confirmation_id": safe_action_id,
        "action": pending["action"],
        "result_status": result_status,
        "result": (
            {
                key: result.get(key)
                for key in (
                    "cleanup_status",
                    "failed_count",
                    "freed_bytes",
                    "purged_count",
                    "rollback_failed_ids",
                    "updated_count",
                )
                if key in result
            }
            if isinstance(result, dict)
            else {}
        ),
    }


@router.post("/chat/confirmations/{action_id}/cancel")
async def cancel_agent_action(
    action_id: str,
    payload: ActionConfirmationRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Cancels one still-pending action in the exact same chat scope."""
    safe_action_id = _validated_action_id(action_id)
    scope = _action_scope(payload, workspace_context)
    try:
        cancelled = await asyncio.to_thread(
            cancel_confirmation,
            safe_action_id,
            scope,
        )
    except Exception as error:
        _raise_confirmation_error(error)
    if not cancelled:
        raise HTTPException(
            status_code=409,
            detail={"code": "confirmation_unavailable"},
        )
    return {"status": "cancelled", "confirmation_id": safe_action_id}


@router.delete(
    "/chat/sessions/{agent_id}/{session_id}",
)
async def delete_chat_session(
    agent_id: str,
    session_id: str,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Remove the persisted LangGraph checkpoints for one scoped chat thread."""
    safe_agent_id = _validated_identifier(agent_id, "agent_id")
    safe_session_id = _validated_identifier(session_id, "session_id")
    _vault, vault_scope = _vault_scope()
    thread_id = _chat_thread_id(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=workspace_context.user_id,
        agent_id=safe_agent_id,
        session_id=safe_session_id,
    )
    checkpoint_key = _checkpoint_key(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=workspace_context.user_id,
        agent_id=safe_agent_id,
    )
    db_path = cfg.paths["CHECKPOINTS"] / f"agent_{checkpoint_key}.sqlite"
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
)
async def rewind_chat_session(
    agent_id: str,
    session_id: str,
    payload: ChatRewindRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """Remove one turn and its suffix from the scoped canonical checkpoint."""
    safe_agent_id = _validated_identifier(agent_id, "agent_id")
    safe_session_id = _validated_identifier(session_id, "session_id")
    _vault, vault_scope = _vault_scope()
    thread_id = _chat_thread_id(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=workspace_context.user_id,
        agent_id=safe_agent_id,
        session_id=safe_session_id,
    )
    checkpoint_key = _checkpoint_key(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=workspace_context.user_id,
        agent_id=safe_agent_id,
    )
    db_path = cfg.paths["CHECKPOINTS"] / f"agent_{checkpoint_key}.sqlite"
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
                        rewound = copy.deepcopy(checkpoint_tuple.checkpoint)
                        rewound["channel_values"] = dict(
                            rewound.get("channel_values", {}),
                            messages=retained_messages,
                        )
                        rewound["pending_sends"] = []
                        metadata = dict(checkpoint_tuple.metadata or {})
                        step = int(metadata.get("step", -1)) + 1
                        rewound = create_checkpoint(rewound, None, step)
                        metadata.update({"source": "update", "step": step})
                        checkpoint_ns = str(
                            checkpoint_tuple.config.get(
                                "configurable",
                                {},
                            ).get("checkpoint_ns", "")
                        )
                        base_config = {
                            "configurable": {
                                "thread_id": thread_id,
                                "checkpoint_ns": checkpoint_ns,
                            },
                        }
                        await saver.adelete_thread(thread_id)
                        try:
                            await saver.aput(
                                base_config,
                                rewound,
                                metadata,
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


@router.get("/chat/sessions/{agent_id}/{session_id}")
async def get_chat_session(
    agent_id: str,
    session_id: str,
    workspace_context: WorkspaceContext = Depends(require_role("viewer")),
):
    """Return the canonical persisted transcript for one scoped session."""
    safe_agent_id = _validated_identifier(agent_id, "agent_id")
    safe_session_id = _validated_identifier(session_id, "session_id")
    _vault, vault_scope = _vault_scope()
    thread_id = _chat_thread_id(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=workspace_context.user_id,
        agent_id=safe_agent_id,
        session_id=safe_session_id,
    )
    checkpoint_key = _checkpoint_key(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=workspace_context.user_id,
        agent_id=safe_agent_id,
    )
    db_path = cfg.paths["CHECKPOINTS"] / f"agent_{checkpoint_key}.sqlite"
    if not db_path.exists():
        return {"messages": []}
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        checkpoint = await saver.aget(
            {"configurable": {"thread_id": thread_id}},
        )
    stored_messages = (
        (checkpoint or {}).get("channel_values", {}).get("messages", [])
    )
    return {"messages": _public_checkpoint_messages(stored_messages)}


@router.get("/ai/model-reliability")
async def model_reliability(
    window_days: int = 30,
    workspace_context: WorkspaceContext = Depends(require_role("viewer")),
):
    """Recorded failures per model, by reason.

    Evidence for the UI, not a policy: nothing here disables or reroutes a
    model — the user reads it and decides.
    """
    _vault, vault_scope = _vault_scope()
    reliability_scope = ":".join((
        vault_scope,
        workspace_context.workspace_id,
        workspace_context.user_id,
    ))
    return {
        "window_days": window_days,
        "models": reliability_report(window_days, scope_key=reliability_scope),
    }


@router.get("/agent/context-sources")
async def list_context_sources():
    """Catalogue of large external sources an agent can attach to its context.

    These are queried through their own API, never crawled — see directive
    `agent_context_sources.md`.
    """
    from backend.agent.context_sources import list_sources
    return list_sources()


@router.get("/agent/internal-sources")
async def list_internal_context_sources(
    workspace_context: WorkspaceContext = Depends(require_role("viewer")),
):
    """List scoped first-party Gnosi sources available in this workspace."""
    from backend.agent.internal_sources import internal_source_catalog

    return internal_source_catalog(workspace_context.workspace_id)


@router.post("/chat")
async def chat_endpoint(
    request: Request,
    chat_req: ChatRequest,
    workspace_context: WorkspaceContext = Depends(require_role("editor")),
):
    """
    Main endpoint for chatting with a specific agent.
    """
    try:
        agent_id = _validated_identifier(chat_req.agent_id, "agent_id")
        session_id = _validated_identifier(chat_req.session_id, "session_id")
        requested_skill_ids = _validated_skill_ids(chat_req.active_skill_ids)
        vault, vault_scope = _vault_scope()

        # 1. Build bounded attachment context and delete the temporary files
        # before provider selection. This cleanup therefore also covers model
        # configuration and workflow-construction failures.
        user_content = chat_req.message
        if chat_req.attachments:
            attachment_scope = _attachment_scope_key(
                vault_scope,
                workspace_context.workspace_id,
                workspace_context.user_id,
                agent_id,
                session_id,
            )
            attachment_text = _consume_attachment_context(
                vault,
                chat_req.attachments,
                attachment_scope,
            )
            if attachment_text:
                user_content += "\n\nVerified attachment context:\n" + attachment_text
        if chat_req.mentions:
            mention_lines = []
            for mention in chat_req.mentions:
                mention_type = (mention.type or "").strip().lower()
                mention_id = (mention.id or "").strip()
                if not mention_type or not mention_id:
                    continue
                mention_label = (mention.label or "").strip() or mention_id
                mention_lines.append(f"- {mention_type}: {mention_label} (id: {mention_id})")

            if mention_lines:
                user_content += "\n\nSelected mentions context:\n" + "\n".join(mention_lines)

        # 2. Get the workflow only after request-owned uploads are cleaned up.
        workflow, llm_selection = await get_agent_workflow(
            request,
            agent_id,
            llm_mode=chat_req.llm_mode,
            llm_provider=chat_req.llm_provider,
            llm_model=chat_req.llm_model,
            user_message=chat_req.message,
            vault_scope=vault_scope,
            vault_path=vault,
            active_skill_ids=requested_skill_ids,
            turn_context_refs=[
                item.model_dump(mode="python")
                for item in chat_req.context_refs
            ],
        )

        authorized_tool_names = _explicit_brain_write_tool_names(
            chat_req.message,
            chat_req.mentions,
        )
        authorized_tool_names.update(
            (llm_selection or {}).get("turn_grant_tool_names") or [],
        )
        inputs = {
            "messages": [HumanMessage(
                content=user_content,
                additional_kwargs={
                    "gnosi_visible_content": chat_req.message,
                    **(
                        {"gnosi_turn_id": chat_req.turn_id}
                        if chat_req.turn_id
                        else {}
                    ),
                },
            )],
            # Always overwrite these request-scoped channels, including with
            # empty lists, so checkpoint state from a previous turn cannot
            # retain authorization or activation.
            "turn_authorized_tool_names": sorted(authorized_tool_names),
            "active_skill_ids": list(
                (llm_selection or {}).get("active_skill_ids") or [],
            ),
            "current_user_role": workspace_context.role,
        }
        
        # 3. Configure memory thread (per agent + session)
        thread_id = _chat_thread_id(
            vault_scope=vault_scope,
            workspace_id=workspace_context.workspace_id,
            user_id=workspace_context.user_id,
            agent_id=agent_id,
            session_id=session_id,
        )
        config = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 12,
        }
        turn_lock = _thread_lock(thread_id)
        
        # 4. Persistence setup
        checkpoint_key = _checkpoint_key(
            vault_scope=vault_scope,
            workspace_id=workspace_context.workspace_id,
            user_id=workspace_context.user_id,
            agent_id=agent_id,
        )
        db_path = cfg.paths["CHECKPOINTS"] / f"agent_{checkpoint_key}.sqlite"
        os.makedirs(db_path.parent, exist_ok=True)
        
        async def event_generator():
            answer_count = 0
            total_in_tok = 0
            total_out_tok = 0
            usage_recorded = False
            active_tool_names: set[str] = set()
            confirmation_token = bind_confirmation_context(
                vault_scope=vault_scope,
                workspace_id=workspace_context.workspace_id,
                user_id=workspace_context.user_id,
                role=workspace_context.role,
                agent_id=agent_id,
                session_id=session_id,
            )
            try:
                deterministic_confirmation = await asyncio.to_thread(
                    _prepare_index_title_replacements,
                    chat_req.message,
                )
                if deterministic_confirmation:
                    answer_count += 1
                    yield json.dumps(
                        deterministic_confirmation,
                        ensure_ascii=False,
                    ) + "\n"
                    yield json.dumps({
                        "type": "done",
                        "has_response": True,
                        "message_count": answer_count,
                    }) + "\n"
                    return
                if llm_selection:
                    yield json.dumps({
                        "type": "llm_selected",
                        "mode": llm_selection.get("mode") or chat_req.llm_mode,
                        "provider": llm_selection.get("provider"),
                        "model": llm_selection.get("model"),
                    }) + "\n"
                    yield json.dumps({
                        "type": "agent_runtime",
                        "assigned_skill_ids": list(
                            llm_selection.get("assigned_skill_ids") or [],
                        ),
                        "active_skill_ids": list(
                            llm_selection.get("active_skill_ids") or [],
                        ),
                        "missing_skill_ids": list(
                            llm_selection.get("missing_skill_ids") or [],
                        ),
                        "unavailable_tool_ids": list(
                            llm_selection.get("unavailable_tool_ids") or [],
                        ),
                        "catalog_revision": llm_selection.get(
                            "catalog_revision",
                        ) or "",
                        "supports_tools": bool(
                            llm_selection.get("supports_tools", False),
                        ),
                        "tool_count": int(
                            llm_selection.get("tool_count", 0) or 0,
                        ),
                    }) + "\n"

                # Spend ledger: every AIMessage in the stream carries
                # usage_metadata; accumulate and record once per turn.
                tool_metadata_by_name = {
                    item.get("name"): item
                    for item in (llm_selection or {}).get("tools", [])
                    if item.get("name")
                }
                async with _acquire_turn_lock(turn_lock):
                    async with asyncio.timeout(TURN_TIMEOUT_SECONDS):
                        async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                            agent_app = workflow.compile(checkpointer=saver)
                            async for event in agent_app.astream(
                                inputs,
                                config=config,
                                stream_mode="updates",
                            ):
                                if await request.is_disconnected():
                                    return
                                for node_name, state_update in event.items():
                                    for msg in state_update.get("messages", []):
                                        turn_usage = usage_from_message(msg)
                                        if turn_usage:
                                            total_in_tok += turn_usage[0]
                                            total_out_tok += turn_usage[1]

                                        tool_calls = getattr(msg, "tool_calls", None) or []
                                        if tool_calls:
                                            for tool_call in tool_calls:
                                                tool_name = str(
                                                    tool_call.get("name") or ""
                                                ).strip()
                                                if tool_name:
                                                    active_tool_names.add(tool_name)
                                                yield _tool_stream_event(
                                                    "tool_start",
                                                    tool_name,
                                                    node_name,
                                                    tool_metadata_by_name.get(
                                                        tool_name,
                                                    ),
                                                )
                                            continue

                                        content = _message_text(getattr(msg, "content", ""))
                                        if msg.type == "tool":
                                            active_tool_names.discard(
                                                str(msg.name or "").strip(),
                                            )
                                            pending_confirmation = confirmation_event(
                                                content,
                                            )
                                            tool_metadata = dict(
                                                tool_metadata_by_name.get(msg.name) or {}
                                            )
                                            tool_metadata["awaiting_confirmation"] = bool(
                                                pending_confirmation
                                            )
                                            yield _tool_stream_event(
                                                "tool_end",
                                                msg.name,
                                                node_name,
                                                tool_metadata,
                                            )
                                            if pending_confirmation:
                                                answer_count += 1
                                                yield json.dumps(
                                                    pending_confirmation,
                                                    ensure_ascii=False,
                                                ) + "\n"
                                        elif msg.type == "ai" and content:
                                            answer_count += 1
                                            yield json.dumps({
                                                "type": "message",
                                                "role": "ai",
                                                "content": content,
                                                "node": node_name,
                                            }) + "\n"

                if total_in_tok or total_out_tok:
                    # to_thread: the ledger does file I/O under a lock
                    await asyncio.to_thread(
                        record_llm_usage,
                        (llm_selection or {}).get("provider"),
                        (llm_selection or {}).get("model"),
                        total_in_tok,
                        total_out_tok,
                    )
                    usage_recorded = True
                yield json.dumps({
                    "type": "done",
                    "has_response": answer_count > 0,
                    "message_count": answer_count,
                }) + "\n"

            except Exception as e:
                error_str = str(e)
                log.exception(
                    "Agent event generator failed (%s; active_tools=%s): %s",
                    type(e).__name__,
                    sorted(active_tool_names),
                    error_str or "no exception message",
                )

                # Record the failure against the model that was actually used, and
                # classify it: the REASON decides whether this is evidence about
                # the model or about the account (a 402 says nothing about the
                # model's abilities). See `model_reliability`.
                provider = (llm_selection or {}).get("provider")
                model_id = (llm_selection or {}).get("model")
                reliability_scope = ":".join((
                    vault_scope,
                    workspace_context.workspace_id,
                    workspace_context.user_id,
                ))
                reason = (
                    None
                    if isinstance(
                        e,
                        (SessionBusyError, TimeoutError, GraphRecursionError),
                    )
                    else record_failure(
                        provider,
                        model_id,
                        e,
                        scope_key=reliability_scope,
                    )
                )

                error_code = _agent_stream_error_code(e)
                if isinstance(e, TimeoutError):
                    friendly_error = (
                        f"The response exceeded the {TURN_TIMEOUT_SECONDS}-second "
                        "processing limit. Try again."
                    )
                elif isinstance(e, GraphRecursionError):
                    friendly_error = (
                        "The agent repeated the same operation and stopped safely. "
                        "Refine the request or try again."
                    )
                elif reason and reason in FAILURE_MESSAGES:
                    friendly_error = FAILURE_MESSAGES[reason]
                    if blames_the_model(reason):
                        evidence = model_evidence(
                            provider,
                            model_id,
                            scope_key=reliability_scope,
                        )
                        repeats = (evidence or {}).get("reasons", {}).get(reason, 0)
                        if repeats > 1:
                            friendly_error += (
                                f" This model has already failed {repeats} times for "
                                "the same reason this month; consider changing it."
                            )
                elif isinstance(e, SessionBusyError):
                    friendly_error = "This conversation is busy. Try again in a moment."
                elif not error_str:
                    friendly_error = "An unexpected agent error occurred."
                else:
                    friendly_error = safe_error_detail(e, context="POST /api/agent/chat event_generator")

                friendly_error = str(friendly_error or "").strip()
                if not friendly_error:
                    friendly_error = "An unexpected agent error occurred."

                error_payload = {"type": "error", "content": friendly_error}
                if error_code:
                    error_payload["code"] = error_code
                yield json.dumps(error_payload) + "\n"
                yield json.dumps({
                    "type": "done",
                    "has_response": True,
                    "message_count": 1,
                }) + "\n"
            finally:
                if not usage_recorded and (total_in_tok or total_out_tok):
                    await asyncio.to_thread(
                        record_llm_usage,
                        (llm_selection or {}).get("provider"),
                        (llm_selection or {}).get("model"),
                        total_in_tok,
                        total_out_tok,
                    )
                reset_confirmation_context(confirmation_token)
        return StreamingResponse(event_generator(), media_type="application/x-ndjson")

    except HTTPException as e:
        if e.status_code == 503:
            error_code = (
                e.detail.get("code")
                if isinstance(e.detail, dict)
                else "service_unavailable"
            )

            async def unavailable_generator():
                yield json.dumps({
                    "type": "error",
                    "code": error_code,
                    "content": error_code,
                }) + "\n"
                yield json.dumps({
                    "type": "done",
                    "has_response": True,
                    "message_count": 1,
                }) + "\n"
            return StreamingResponse(
                unavailable_generator(),
                media_type="application/x-ndjson",
                status_code=200,
            )
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /api/agent/chat"))
