from sqlalchemy import (
    Column,
    String,
    Integer,
    DateTime,
    ForeignKey,
    Enum as SqlEnum,
    Text,
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import enum
import uuid
from backend.data.management_db import Base
from backend.models._datetime_utils import normalize_utc
from pydantic import BaseModel, EmailStr, ConfigDict, field_serializer
from typing import Optional, List


class ContactType(str, enum.Enum):
    PERSONAL = "personal"
    B2B = "b2b"


class ContactSource(str, enum.Enum):
    LOCAL = "local"
    GOOGLE = "google"
    APPLE = "apple"


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(
        String, ForeignKey("workspaces.id"), nullable=False, index=True
    )
    type = Column(String, default=ContactType.PERSONAL.value, nullable=False)

    name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True)

    company = Column(String, nullable=True)
    job_title = Column(String, nullable=True)
    address = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    emails = Column(Text, default="[]")
    phones = Column(Text, default="[]")
    addresses = Column(Text, default="[]")

    google_resource_name = Column(String, nullable=True, index=True)
    apple_resource_id = Column(String, nullable=True)

    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String, default=ContactSource.LOCAL.value, nullable=False)
    photo_url = Column(String, nullable=True)

    tags = Column(String, default="[]")

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    workspace = relationship("Workspace")


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
    emails: Optional[List[dict]] = []
    phones: Optional[List[dict]] = []
    addresses: Optional[List[dict]] = []
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
    emails: Optional[List[dict]] = None
    phones: Optional[List[dict]] = None
    addresses: Optional[List[dict]] = None
    photo_url: Optional[str] = None


class ContactResponse(ContactBase):
    id: str
    workspace_id: str
    google_resource_name: Optional[str] = None
    apple_resource_id: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    source: ContactSource
    tags: List[str]
    emails: List[dict]
    phones: List[dict]
    addresses: List[dict]
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
