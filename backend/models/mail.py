from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey
from pydantic import BaseModel, ConfigDict, field_serializer
from typing import Optional, List, Any
from datetime import datetime, timezone
import uuid
from backend.data.db import Base
from backend.models._datetime_utils import normalize_utc


class MailMessage(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, index=True)
    thread_id = Column(String, index=True)
    account_email = Column(String, index=True)
    subject = Column(String)
    sender = Column(String)
    recipient = Column(String)
    cc = Column(String)
    bcc = Column(String)
    date = Column(String)
    timestamp = Column(Integer)
    body_text = Column(Text)
    body_html = Column(Text)
    snippet = Column(String)
    is_read = Column(Boolean, default=False)
    is_starred = Column(Boolean, default=False)
    category = Column(String)
    labels = Column(String)  # Comma separated
    raw_json = Column(Text)


class MailTag(Base):
    __tablename__ = "mail_tags"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    color = Column(String, default="#3b82f6")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class MailMessageTag(Base):
    __tablename__ = "mail_message_tags"

    message_id = Column(String, primary_key=True)
    tag_id = Column(String, ForeignKey("mail_tags.id", ondelete="CASCADE"), primary_key=True)
    account_email = Column(String, default="")
    subject = Column(String, default="")
    sender = Column(String, default="")
    date_str = Column(String, default="")


class MailView(Base):
    __tablename__ = "mail_views"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    fields = Column(Text, default="[]")       # JSON: [{key, visible, order, width?}]
    filters = Column(Text, default="[]")      # JSON: [{field, operator, value}]
    filter_logic = Column(String, default="AND")  # "AND" | "OR"
    group_by = Column(String, default="none")
    sort_by = Column(String, default="date")
    sort_dir = Column(String, default="desc")
    actions = Column(Text, default='["archive","trash","mark_read"]')  # JSON array
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


# ── Pydantic Schemas ────────────────────────────────────────────────────────────

class MailMessageSchema(BaseModel):
    id: str
    thread_id: str
    account_email: str
    subject: str
    sender: str
    recipient: str
    cc: Optional[str]
    bcc: Optional[str]
    date: str
    timestamp: int
    body_text: Optional[str]
    body_html: Optional[str]
    snippet: Optional[str]
    is_read: bool
    is_starred: bool
    category: Optional[str]
    labels: Optional[str]

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)


class MailUpdateSchema(BaseModel):
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    category: Optional[str] = None
    labels: Optional[str] = None


class MailViewFieldSchema(BaseModel):
    key: str
    visible: bool = True
    order: int
    width: Optional[int] = None


class MailViewFilterSchema(BaseModel):
    field: str
    operator: str  # contains | starts_with | equals | is | is_not | before | after
    value: Any


class MailViewCreateSchema(BaseModel):
    name: str
    fields: List[MailViewFieldSchema] = []
    filters: List[MailViewFilterSchema] = []
    filter_logic: str = "AND"
    group_by: str = "none"
    sort_by: str = "date"
    sort_dir: str = "desc"
    actions: List[str] = ["archive", "trash", "mark_read"]


class MailViewUpdateSchema(MailViewCreateSchema):
    name: Optional[str] = None


class MailViewSchema(BaseModel):
    id: str
    name: str
    fields: List[MailViewFieldSchema]
    filters: List[MailViewFilterSchema]
    filter_logic: str
    group_by: str
    sort_by: str
    sort_dir: str
    actions: List[str]
    created_at: datetime
    updated_at: datetime

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at", "updated_at")
    def _ser_dt(self, v: datetime) -> str:
        return normalize_utc(v)


# ── Tag Schemas ─────────────────────────────────────────────────────────────────

class MailTagCreateSchema(BaseModel):
    name: str
    color: str = "#3b82f6"


class MailTagUpdateSchema(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class MailTagSchema(BaseModel):
    id: str
    name: str
    color: str
    created_at: datetime

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def _ser_dt(self, v: datetime) -> str:
        return normalize_utc(v)


class MailMessageTagsSetSchema(BaseModel):
    tag_ids: List[str]
    account_email: str = ""
    subject: str = ""
    sender: str = ""
    date_str: str = ""
