from typing import Literal

from pydantic import BaseModel, ConfigDict, JsonValue


class _AgentResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentAttachmentUploadResponse(_AgentResponseModel):
    name: str
    size: int
    type: str
    path: str


class AgentDeleteResponse(_AgentResponseModel):
    deleted: bool


class AgentChatFeedbackResponse(_AgentResponseModel):
    status: Literal["recorded"]
    event_id: str


class AgentStreamCancellationResponse(_AgentResponseModel):
    status: Literal["cancellation_requested"]


class AgentSessionMessageResponse(_AgentResponseModel):
    role: Literal["user", "assistant"]
    content: str
    author_user_id: str | None = None
    turn_id: str | None = None
    plan: JsonValue | None = None
    privacy: JsonValue | None = None
    verification: JsonValue | None = None
    citations: JsonValue | None = None
    freshness: JsonValue | None = None
    job: JsonValue | None = None
    explanation: JsonValue | None = None
    quality: JsonValue | None = None
    conflicts: JsonValue | None = None
    evidence_security: JsonValue | None = None
    timings: JsonValue | None = None


class AgentSessionMessagesResponse(_AgentResponseModel):
    messages: list[AgentSessionMessageResponse]


class AgentConfirmationRecordResponse(_AgentResponseModel):
    type: Literal["confirmation_required"]
    confirmation_id: str
    action: str
    title_key: str
    summary_key: str
    details: dict[str, JsonValue]
    destructive: bool
    created_at: float
    expires_at: float
    status: str
    result: dict[str, JsonValue]
    error_code: str


class AgentConfirmationListResponse(_AgentResponseModel):
    confirmations: list[AgentConfirmationRecordResponse]


class AgentCapabilityAuditEventResponse(_AgentResponseModel):
    id: str
    tool_id: str
    tool_name: str
    effects: list[str]
    status: str
    argument_keys: list[str]
    result_kind: str
    error_code: str
    duration_ms: int
    created_at: float


class AgentCapabilityAuditListResponse(_AgentResponseModel):
    events: list[AgentCapabilityAuditEventResponse]


class AgentReplayEventResponse(_AgentResponseModel):
    event_id: str
    event_type: str
    attributes: dict[str, JsonValue]
    created_at: str


class AgentReplayResponse(_AgentResponseModel):
    trace_id: str
    events: list[AgentReplayEventResponse]


class AgentConfirmationExecutionSummaryResponse(_AgentResponseModel):
    cleanup_status: str | None = None
    failed_count: int | None = None
    freed_bytes: int | None = None
    purged_count: int | None = None
    rollback_failed_ids: list[str] | None = None
    updated_count: int | None = None


class AgentConfirmationExecutionResponse(_AgentResponseModel):
    status: Literal["cancelled", "completed", "failed", "partial"]
    confirmation_id: str
    action: str
    result_status: str
    result: AgentConfirmationExecutionSummaryResponse


class AgentConfirmationCancelResponse(_AgentResponseModel):
    status: Literal["cancelled"]
    confirmation_id: str
