import asyncio
import hashlib
import json
import re
import weakref
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, List, Optional

from backend.domains.agent.routes.contracts import TURN_LOCK_TIMEOUT_SECONDS
from backend.domains.agent.routes.shared import _message_text

_THREAD_LOCKS: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()


def _chat_thread_id(
    *,
    vault_scope: str,
    workspace_id: str,
    user_id: str,
    agent_id: str,
    session_id: str,
) -> str:
    """Return a tenant- and user-isolated LangGraph thread identifier."""
    payload = ":".join(
        (
            vault_scope,
            workspace_id,
            user_id,
            agent_id,
            session_id,
        )
    )
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


_TURN_ID_FIELD_RE = re.compile(
    r"^(?:gnosi_)?(?:turn|session|conversation|thread|trace)(?:_(?:id|uuid|identifier|ref|reference|key|token))?$"
    r"|^(?:id|uuid|identifier|ref|reference|key|token)_(?:turn|session|conversation|thread|trace)$"
    r"|^turn$"
)


def _normalize_turn_key(key: str) -> str:
    normalized = re.sub(r"[^a-z0-9_]+", "_", str(key).strip().lower())
    return re.sub(r"_+", "_", normalized).strip("_")


def _extract_turn_payload_value(  # noqa: C901 - bounded recursive compatibility parser
    candidate_value: Any,
    seen: Optional[set[int]] = None,
) -> Optional[str]:
    if candidate_value is None or candidate_value == "":
        return None
    if isinstance(candidate_value, (str, int, float)):
        text = str(candidate_value).strip()
        return text or None
    if isinstance(candidate_value, dict):
        candidate_id = (
            candidate_value.get("id")
            or candidate_value.get("turn_id")
            or candidate_value.get("turnId")
            or candidate_value.get("value")
            or candidate_value.get("uuid")
            or candidate_value.get("identifier")
            or candidate_value.get("key")
        )
        if candidate_id is not None:
            text = str(candidate_id).strip()
            return text or None
        if seen is None:
            seen = set()
        marker = id(candidate_value)
        if marker in seen:
            return None
        seen.add(marker)
        for nested_key, nested_value in candidate_value.items():
            if not _TURN_ID_FIELD_RE.match(_normalize_turn_key(nested_key)):
                continue
            nested_turn_id = _extract_turn_payload_value(nested_value, seen)
            if nested_turn_id is not None:
                return nested_turn_id
        return None
    if isinstance(candidate_value, (list, tuple)):
        for item in candidate_value:
            nested_turn_id = _extract_turn_payload_value(item, seen)
            if nested_turn_id is not None:
                return nested_turn_id
    return None


def _extract_turn_payload(
    payload: Dict[str, Any],
    *,
    allow_nested: bool = False,
) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    turn_id = payload.get("gnosi_turn_id") or payload.get("turn_id") or payload.get("turnId")
    if turn_id is None and allow_nested:
        nested_turn = payload.get("turn")
        if isinstance(nested_turn, dict):
            turn_id = (
                nested_turn.get("id")
                or nested_turn.get("turn_id")
                or nested_turn.get("turnId")
                or nested_turn.get("value")
            )
        elif isinstance(nested_turn, str):
            turn_id = nested_turn
    if isinstance(turn_id, dict):
        turn_id = (
            turn_id.get("id")
            or turn_id.get("turn_id")
            or turn_id.get("turnId")
            or turn_id.get("value")
        )
    if turn_id is not None and turn_id != "":
        return str(turn_id)
    for key, value in payload.items():
        if _TURN_ID_FIELD_RE.match(_normalize_turn_key(key)):
            candidate = _extract_turn_payload_value(value)
            if candidate is not None:
                return candidate
    return turn_id


def _checkpoint_turn_id(message: Any, role: str, current_turn_id: str) -> str:
    if role == "human":
        current_turn_id = str(
            getattr(message, "additional_kwargs", {}).get("gnosi_turn_id", "") or ""
        )
    message_turn_id = _extract_turn_payload(
        getattr(message, "additional_kwargs", {}),
        allow_nested=True,
    )
    if message_turn_id is None:
        message_turn_id = _extract_turn_payload(
            getattr(message, "metadata", {}),
            allow_nested=True,
        )
    if message_turn_id and (role == "human" or not current_turn_id):
        return str(message_turn_id)
    return current_turn_id


def _checkpoint_content(message: Any, role: str) -> str:
    visible_content = (
        getattr(message, "additional_kwargs", {}).get("gnosi_visible_content")
        if role == "human"
        else None
    )
    content = (
        str(visible_content)
        if visible_content is not None
        else _message_text(getattr(message, "content", ""))
    )
    if role != "human" or visible_content is not None:
        return content
    marker_positions = [
        position
        for marker in ("\n\nAttachment:", "\n\nSelected mentions context:")
        if (position := content.find(marker)) >= 0
    ]
    return content[: min(marker_positions)] if marker_positions else content


def _checkpoint_public_message(
    message: Any,
    *,
    role: str,
    content: str,
    turn_id: str,
) -> Dict[str, Any]:
    public_message: Dict[str, Any] = {
        "role": "user" if role == "human" else "assistant",
        "content": content,
    }
    if role == "human":
        author_user_id = str(
            getattr(message, "additional_kwargs", {}).get("gnosi_author_user_id", "") or ""
        )
        if author_user_id:
            public_message["author_user_id"] = author_user_id
    if role == "ai":
        assistant_metadata = dict(getattr(message, "additional_kwargs", {}) or {})
        for public_key, internal_key in (
            ("plan", "gnosi_plan"),
            ("privacy", "gnosi_privacy"),
            ("verification", "gnosi_verification"),
            ("citations", "gnosi_citations"),
            ("freshness", "gnosi_freshness"),
            ("job", "gnosi_job"),
            ("explanation", "gnosi_explanation"),
            ("quality", "gnosi_quality"),
            ("conflicts", "gnosi_conflicts"),
            ("evidence_security", "gnosi_evidence_security"),
            ("timings", "gnosi_timings"),
        ):
            value = assistant_metadata.get(internal_key)
            if value is not None:
                public_message[public_key] = value
    if turn_id:
        public_message["turn_id"] = turn_id
    return public_message


def _public_checkpoint_message_entries(
    stored_messages: List[Any],
) -> List[tuple[int, Dict[str, Any]]]:
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
        current_turn_id = _checkpoint_turn_id(message, role, current_turn_id)
        content = _checkpoint_content(message, role)
        if not content.strip():
            continue
        entries.append(
            (
                raw_index,
                _checkpoint_public_message(
                    message,
                    role=role,
                    content=content,
                    turn_id=current_turn_id,
                ),
            )
        )
    return entries


def _public_checkpoint_messages(stored_messages: List[Any]) -> List[Dict[str, Any]]:
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
            if message.get("role") == "user" and message.get("turn_id") == before_turn_id:
                return list(stored_messages[:raw_index])
        raise ValueError("The requested conversation turn is unavailable.")

    retained_count = min(max(0, keep_messages), len(entries))
    while retained_count > 0 and entries[retained_count - 1][1].get("role") != "assistant":
        retained_count -= 1
    if retained_count == 0:
        return []
    cutoff = entries[retained_count - 1][0]
    return list(stored_messages[: cutoff + 1])


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
            str(item) for item in ((ai_cfg or {}).get("disconnected_providers") or [])
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
async def _acquire_turn_lock(lock: asyncio.Lock) -> AsyncIterator[None]:
    try:
        await asyncio.wait_for(lock.acquire(), timeout=TURN_LOCK_TIMEOUT_SECONDS)
    except TimeoutError as error:
        raise SessionBusyError("chat_session_busy") from error
    try:
        yield
    finally:
        lock.release()
