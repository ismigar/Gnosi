from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from backend.data.db import Base
from backend.domains.mail.schemas import MailMessageSchema as MailMessageSchema
from backend.domains.mail.schemas import MailMessageTagsSetSchema as MailMessageTagsSetSchema
from backend.domains.mail.schemas import MailTagCreateSchema as MailTagCreateSchema
from backend.domains.mail.schemas import MailTagSchema as MailTagSchema
from backend.domains.mail.schemas import MailTagUpdateSchema as MailTagUpdateSchema
from backend.domains.mail.schemas import MailUpdateSchema as MailUpdateSchema
from backend.domains.mail.schemas import MailViewCreateSchema as MailViewCreateSchema
from backend.domains.mail.schemas import MailViewFieldSchema as MailViewFieldSchema
from backend.domains.mail.schemas import MailViewFilterSchema as MailViewFilterSchema
from backend.domains.mail.schemas import MailViewSchema as MailViewSchema
from backend.domains.mail.schemas import MailViewUpdateSchema as MailViewUpdateSchema


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
    fields = Column(Text, default="[]")  # JSON: [{key, visible, order, width?}]
    filters = Column(Text, default="[]")  # JSON: [{field, operator, value}]
    filter_logic = Column(String, default="AND")  # "AND" | "OR"
    group_by = Column(String, default="none")
    sort_by = Column(String, default="date")
    sort_dir = Column(String, default="desc")
    actions = Column(Text, default='["archive","trash","mark_read"]')  # JSON array
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
