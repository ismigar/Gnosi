"""Pinned public table forms and durable submission identities."""

from datetime import datetime, timezone
import secrets
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.data.management_db import Base


class FormDefinition(Base):
    __tablename__ = "public_forms"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    token: Mapped[str] = mapped_column(String, unique=True, index=True, default=lambda: secrets.token_urlsafe(32))
    workspace_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    vault_id: Mapped[str] = mapped_column(String, ForeignKey("vaults.id"), nullable=False)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    table_id: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    fields_json: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FormSubmission(Base):
    __tablename__ = "public_form_submissions"
    __table_args__ = (UniqueConstraint("form_id", "request_id", name="uq_form_submission_request"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    form_id: Mapped[str] = mapped_column(String, ForeignKey("public_forms.id"), nullable=False, index=True)
    request_id: Mapped[str] = mapped_column(String, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
