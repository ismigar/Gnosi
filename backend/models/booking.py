"""Durable, vault-scoped booking links and reservation claims."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.data.management_db import Base


class BookingLink(Base):
    __tablename__ = "booking_links"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    workspace_id: Mapped[str] = mapped_column(String, ForeignKey("workspaces.id"), index=True)
    vault_id: Mapped[str] = mapped_column(String, ForeignKey("vaults.id"), index=True)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class BookingReservation(Base):
    __tablename__ = "booking_reservations"
    __table_args__ = (
        UniqueConstraint("link_id", "idempotency_key", name="uq_booking_reservation_request"),
        Index("ix_booking_owner_interval", "workspace_id", "owner_id", "blocked_start", "blocked_end"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    link_id: Mapped[str] = mapped_column(String, ForeignKey("booking_links.id"), index=True)
    workspace_id: Mapped[str] = mapped_column(String, ForeignKey("workspaces.id"))
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False)
    request_hash: Mapped[str] = mapped_column(String, nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    blocked_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    blocked_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    event_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
