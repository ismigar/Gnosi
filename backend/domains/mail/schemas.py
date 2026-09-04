"""Pydantic contracts for the public Mail API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    RootModel,
    field_serializer,
    model_validator,
)

from backend.models._datetime_utils import normalize_utc


class MailProviderPayload(BaseModel):
    """Typed stable fields while retaining provider-specific extensions."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class MailRequestPayload(BaseModel):
    """Backward-compatible JSON request accepting legacy extension fields."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class MailFolderCountResponse(MailProviderPayload):
    total: int = 0
    unread: int = 0


class MailCountsResponse(RootModel[dict[str, MailFolderCountResponse]]):
    """Counts keyed by provider folder or virtual category."""


class MailAttachmentResponse(MailProviderPayload):
    part_index: int | None = None
    content_type: str | None = None
    size: int | None = None
    filename: str | None = None
    cid: str | None = None


class MailMessageResponse(MailProviderPayload):
    """Provider-neutral message with preserved provider additions."""

    id: str
    thread_id: str
    subject: str
    sender: str
    recipient: str | list[str] | None = None
    cc: str | list[str] | None = None
    bcc: str | list[str] | None = None
    date: str = ""
    timestamp: int | float = 0
    snippet: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    is_read: bool = False
    is_starred: bool = False
    has_attachments: bool = False
    attachments: list[MailAttachmentResponse] | None = None
    inline_images: list[MailAttachmentResponse] | None = None
    category: str | None = None
    type: str | None = None
    account: str | None = None
    source: str | None = None
    archived: bool | None = None
    imap_uid: str | None = None
    imap_folder: str | None = None
    gm_thrid: str | None = None
    internet_message_id: str | None = None


class MailMessagesResponse(BaseModel):
    messages: list[MailMessageResponse]
    next_page_token: str | None
    total: int
    error: str | None = None


class MailThreadResponse(BaseModel):
    messages: list[MailMessageResponse]


class MailStatusResponse(BaseModel):
    status: str


class MailSyncResponse(BaseModel):
    status: Literal["success", "partial"]
    synced_count: int
    accounts: list[str]
    failed: list[str]


class MailMessageUpdateRequest(MailRequestPayload):
    is_read: bool | None = None
    is_starred: bool | None = None
    snoozed_until: str | None = None
    category: str | None = None


class MailStarRequest(MailRequestPayload):
    starred: bool


class MailSpamRequest(MailRequestPayload):
    spam: bool


class MailAccountEnabledRequest(MailRequestPayload):
    enabled: JsonValue = True


class MailAccountEnabledResponse(BaseModel):
    email: str
    enabled: bool


class MailDraftSaveRequest(MailRequestPayload):
    draft_id: str | None = None
    imap_uid: str | None = None
    to: str = ""
    cc: str = ""
    bcc: str = ""
    subject: str = ""
    body: str = ""
    account: str = ""


class MailDraftSaveResponse(BaseModel):
    status: Literal["success"]
    draft_id: str
    imap_uid: str | None


class MailRecipientSuggestionResponse(MailProviderPayload):
    email: str
    name: str
    source: str
    freq: int


class MailRecipientSuggestionsResponse(BaseModel):
    suggestions: list[MailRecipientSuggestionResponse]
    group_suggestions: list[MailRecipientSuggestionResponse]


class MailFolderResponse(MailProviderPayload):
    name: str
    type: str


class MailFoldersResponse(BaseModel):
    folders: list[MailFolderResponse]


class MailMoveRequest(MailRequestPayload):
    target_folder: str | None = None
    imap_uid: str | None = None
    imap_folder: str | None = None


class MailBatchRequest(MailRequestPayload):
    action: str | None = None
    ids: list[str] = Field(default_factory=list)


class MailBatchResponse(BaseModel):
    status: Literal["success"]
    processed: int


class MailSnoozeRequest(MailRequestPayload):
    snooze_until: str | None = None


class MailGenerateDraftRequest(MailRequestPayload):
    context: str = ""
    prompt: str = "Write a professional response."


class MailGenerateDraftResponse(BaseModel):
    draft: str
    provider: str


class MailExtractEntitiesRequest(MailRequestPayload):
    context: str = ""
    sender: str = ""
    recipients: list[str] = Field(default_factory=list, max_length=50)
    attachments: list[str] = Field(default_factory=list, max_length=50)


class MailAnalysisEvidence(BaseModel):
    kind: Literal["summary", "participant", "attachment", "indicator", "task", "date"]
    label: str
    value: str
    confidence: float = Field(ge=0, le=1)
    origin: Literal[
        "message_body",
        "message_header",
        "attachment_metadata",
        "message_metadata",
        "vevent",
    ]


class MailLocalAnalysisResponse(BaseModel):
    summary: MailAnalysisEvidence | None = None
    participants: list[MailAnalysisEvidence] = Field(default_factory=list)
    attachments: list[MailAnalysisEvidence] = Field(default_factory=list)
    indicators: list[MailAnalysisEvidence] = Field(default_factory=list)
    tasks: list[MailAnalysisEvidence] = Field(default_factory=list)
    dates: list[MailAnalysisEvidence] = Field(default_factory=list)


class MailProviderAttemptResponse(BaseModel):
    provider: str
    status: Literal[
        "success",
        "timeout",
        "unauthorized",
        "rate_limited",
        "server_error",
        "network_error",
        "invalid_response",
        "unavailable",
    ]


class MailExtractEntitiesResponse(BaseModel):
    events: list[JsonValue]
    contacts: list[JsonValue]
    provider: str | None = None
    error: str | None = None
    raw: str | None = None
    status: Literal["complete", "degraded"] | None = None
    result_source: Literal["provider", "local", "previous_valid"] | None = None
    degraded_reason: Literal["not_configured", "providers_failed"] | None = None
    analysis_reason: Literal[
        "not_configured",
        "disabled",
        "timeout",
        "credentials",
        "quota",
        "temporarily_unavailable",
        "invalid_response",
        "internal_error",
    ] | None = None
    provider_attempts: list[MailProviderAttemptResponse] = Field(default_factory=list)
    local_analysis: MailLocalAnalysisResponse | None = None


class MailViewFieldSchema(BaseModel):
    key: str
    visible: bool = True
    order: int
    width: int | None = None


class MailViewFilterSchema(BaseModel):
    field: str
    operator: str
    value: JsonValue


class MailViewCreateSchema(BaseModel):
    name: str
    fields: list[MailViewFieldSchema] = Field(default_factory=list)
    filters: list[MailViewFilterSchema] = Field(default_factory=list)
    filter_logic: str = "AND"
    group_by: str = "none"
    sort_by: str = "date"
    sort_dir: str = "desc"
    actions: list[str] = Field(default_factory=lambda: ["archive", "trash", "mark_read"])


class MailViewUpdateSchema(BaseModel):
    name: str | None = None
    fields: list[MailViewFieldSchema] = Field(default_factory=list)
    filters: list[MailViewFilterSchema] = Field(default_factory=list)
    filter_logic: str = "AND"
    group_by: str = "none"
    sort_by: str = "date"
    sort_dir: str = "desc"
    actions: list[str] = Field(default_factory=lambda: ["archive", "trash", "mark_read"])


class MailViewResponse(BaseModel):
    id: str
    name: str
    fields: list[MailViewFieldSchema]
    filters: list[MailViewFilterSchema]
    filter_logic: str
    group_by: str
    sort_by: str
    sort_dir: str
    actions: list[str]
    created_at: str | None
    updated_at: str | None


class MailTagCreateSchema(BaseModel):
    name: str
    color: str = "#3b82f6"


class MailTagUpdateSchema(BaseModel):
    name: str | None = None
    color: str | None = None


class MailTagResponse(BaseModel):
    id: str
    name: str
    color: str
    created_at: str | None


class MailMessageIdentityScope(BaseModel):
    """Provider-scoped identity for one persisted mail association."""

    account_email: str
    source: str
    imap_folder: str | None = None
    imap_uid: str | None = None

    @model_validator(mode="after")
    def validate_complete_scope(self) -> MailMessageIdentityScope:
        if not self.account_email.strip() or not self.source.strip():
            raise ValueError("account_email and source are required")
        if self.source.strip().lower() == "imap" and (
            not (self.imap_folder or "").strip()
            or not (self.imap_uid or "").strip()
        ):
            raise ValueError("IMAP identity requires imap_folder and imap_uid")
        return self


class MailMessageTagDescriptor(MailMessageIdentityScope):
    """Batch descriptor carrying both raw and provider-scoped identity."""

    message_id: str


class MailMessageTagsSetSchema(BaseModel):
    tag_ids: list[str]
    account_email: str = ""
    subject: str = ""
    sender: str = ""
    date_str: str = ""
    identity_scope: MailMessageIdentityScope | None = None


class MailMessageTagsResponse(BaseModel):
    status: Literal["success"]
    tag_ids: list[str]


class MailTaggedMessageResponse(BaseModel):
    message_id: str
    account_email: str
    subject: str
    sender: str
    date_str: str
    message_identity: str | None = None
    identity_kind: Literal["legacy", "scoped"] | None = None
    source: str | None = None
    imap_folder: str | None = None
    provider_uid: str | None = None


class MailTaggedMessagesResponse(BaseModel):
    tag: MailTagResponse
    messages: list[MailTaggedMessageResponse]


class MailTagsBatchRequest(MailRequestPayload):
    message_ids: list[str] = Field(default_factory=list)
    messages: list[MailMessageTagDescriptor] = Field(default_factory=list)


class MailTagsByMessageResponse(RootModel[dict[str, list[str]]]):
    """Tag identifiers keyed by raw legacy ID or composite scoped identity."""


class MailMessageSchema(BaseModel):
    """Compatibility schema for the persisted SQL mail model."""

    id: str
    thread_id: str
    account_email: str
    subject: str
    sender: str
    recipient: str
    cc: str | None
    bcc: str | None
    date: str
    timestamp: int
    body_text: str | None
    body_html: str | None
    snippet: str | None
    is_read: bool
    is_starred: bool
    category: str | None
    labels: str | None

    model_config = ConfigDict(from_attributes=True)


class MailUpdateSchema(BaseModel):
    """Compatibility update schema used by older internal callers."""

    is_read: bool | None = None
    is_starred: bool | None = None
    category: str | None = None
    labels: str | None = None


class MailViewSchema(BaseModel):
    """Compatibility schema for the persisted SQL view model."""

    id: str
    name: str
    fields: list[MailViewFieldSchema]
    filters: list[MailViewFilterSchema]
    filter_logic: str
    group_by: str
    sort_by: str
    sort_dir: str
    actions: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at", "updated_at")
    def _serialize_datetime(self, value: datetime) -> str:
        return normalize_utc(value)


class MailTagSchema(BaseModel):
    """Compatibility schema for the persisted SQL tag model."""

    id: str
    name: str
    color: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def _serialize_datetime(self, value: datetime) -> str:
        return normalize_utc(value)
