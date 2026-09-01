import enum
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, field_serializer
from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.data.management_db import Base
from backend.models._datetime_utils import normalize_utc

if TYPE_CHECKING:
    from backend.models.management import Workspace


class ContactType(str, enum.Enum):
    PERSONAL = "personal"
    B2B = "b2b"


class ContactSource(str, enum.Enum):
    LOCAL = "local"
    GOOGLE = "google"
    APPLE = "apple"


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String, default=ContactType.PERSONAL.value, nullable=False)

    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)

    company: Mapped[str | None] = mapped_column(String, nullable=True)
    job_title: Mapped[str | None] = mapped_column(String, nullable=True)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    emails: Mapped[str] = mapped_column(Text, default="[]")
    phones: Mapped[str] = mapped_column(Text, default="[]")
    addresses: Mapped[str] = mapped_column(Text, default="[]")

    google_resource_name: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    apple_resource_id: Mapped[str | None] = mapped_column(String, nullable=True)

    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String, default=ContactSource.LOCAL.value, nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String, nullable=True)

    tags: Mapped[str] = mapped_column(String, default="[]")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    workspace: Mapped["Workspace"] = relationship("Workspace")


class ContactBase(BaseModel):
    name: str
    email: EmailStr
    type: ContactType = ContactType.PERSONAL
    phone: Optional[str] = None
    company: Optional[str] = None
    job_title: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = []
    emails: Optional[List[dict[str, Any]]] = []
    phones: Optional[List[dict[str, Any]]] = []
    addresses: Optional[List[dict[str, Any]]] = []
    photo_url: Optional[str] = None


class ContactCreate(ContactBase):
    pass


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    type: Optional[ContactType] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    job_title: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    emails: Optional[List[dict[str, Any]]] = None
    phones: Optional[List[dict[str, Any]]] = None
    addresses: Optional[List[dict[str, Any]]] = None
    photo_url: Optional[str] = None


class ContactResponse(ContactBase):
    id: str
    workspace_id: str
    google_resource_name: Optional[str] = None
    apple_resource_id: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    source: ContactSource
    tags: List[str]
    emails: List[dict[str, Any]]
    phones: List[dict[str, Any]]
    addresses: List[dict[str, Any]]
    photo_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # Pydantic v2: ConfigDict instead of class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at", "updated_at", "last_synced_at")
    def _ser_dt(self, v: Optional[datetime]) -> Optional[str]:
        return normalize_utc(v)


class ContactSyncStatus(BaseModel):
    last_sync_at: Optional[datetime] = None
    contacts_count: int = 0
    google_synced_count: int = 0
    pending_sync_count: int = 0
    last_error: Optional[str] = None
