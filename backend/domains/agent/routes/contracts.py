import re
from typing import Any, Dict, List, Optional, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    def validate_context_source(self) -> Self:
        from backend.agent.internal_sources import normalize_internal_scope

        source_type = self.type.strip().lower()
        source_ref = self.ref.strip()
        if source_type == "internal":
            self.type = source_type
            self.ref = source_ref.lower()
            self.scope = normalize_internal_scope(self.ref, self.scope)
            return self
        if source_type not in {"page", "table", "database", "vault", "notebook"}:
            raise ValueError("Turn context accepts read-only Gnosi module sources only.")
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
        elif source_type == "notebook":
            # The server replaces this with the authorized active revision.
            # Client-provided revision values are never trusted.
            requested_scope = self.scope if isinstance(self.scope, dict) else {}
            selection = str(requested_scope.get("selection") or "all").lower()
            source_ids = list(
                dict.fromkeys(
                    str(value).strip()[:128]
                    for value in (requested_scope.get("source_ids") or [])
                    if str(value or "").strip()
                )
            )
            if len(source_ids) > 1_000:
                raise ValueError("A notebook turn accepts at most 1,000 sources.")
            self.scope = {
                "selection": "sources" if selection == "sources" else "all",
                "source_ids": source_ids if selection == "sources" else [],
            }
        else:
            self.scope = {}
        return self


class ChatRequest(BaseModel):
    message: str = Field(max_length=100_000)
    agent_id: str = "gnosy"  # Default agent
    session_id: str = "default"
    history: List[Dict[str, Any]] = Field(default_factory=list)
    llm_mode: str = "agent_default"  # auto | manual | agent_default
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    mentions: List[MentionRef] = Field(default_factory=list, max_length=20)
    attachments: List[AttachmentRef] = Field(default_factory=list, max_length=8)
    active_skill_ids: Optional[List[str]] = Field(default=None, max_length=64)
    context_refs: List[TurnContextRef] = Field(default_factory=list, max_length=16)
    notebook_id: Optional[str] = Field(default=None, max_length=64)
    turn_id: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
    )

    @model_validator(mode="before")
    @classmethod
    def reject_client_confirmation_grants(cls, value: Any) -> Any:
        """Reject the removed client-side approval bypass explicitly."""
        if isinstance(value, dict) and "confirmed_tool_ids" in value:
            raise ValueError("Client-provided tool confirmations are not accepted.")
        return value


class ChatFeedbackRequest(BaseModel):
    """Bounded metadata-only feedback for one assistant turn."""

    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    turn_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    rating: str = Field(pattern=r"^(up|down|clear)$")
    language: str = Field(default="en", max_length=8)
    mode: str = Field(default="analysis", max_length=32)
    domains: List[str] = Field(default_factory=list, max_length=12)
    route: str = Field(default="General", max_length=32)
    execution: str = Field(default="foreground", max_length=32)
    output_strategy: str = Field(default="model_synthesis", max_length=32)
    required_tool: str = Field(default="", max_length=128)
    verification_status: str = Field(default="", max_length=32)
    limitations: List[str] = Field(default_factory=list, max_length=8)
    tool_names: List[str] = Field(default_factory=list, max_length=16)
    duration_ms: int = Field(default=0, ge=0, le=86_400_000)
    error_code: str = Field(default="", max_length=160)


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
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".css",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".pdf",
}
