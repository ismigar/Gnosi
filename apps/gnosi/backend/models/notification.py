from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from backend.data.management_db import Base
from backend.models.management import Workspace
from backend.models._datetime_utils import normalize_utc
from pydantic import BaseModel, ConfigDict, field_serializer
from typing import Optional

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, ForeignKey("workspaces.id"), nullable=False, index=True)

    level = Column(String, default="INFO", nullable=False) # INFO, SUCCESS, WARNING, ERROR
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)

    # `timezone=True` so that SQLAlchemy persists the offset and the response
    # ISO inclogui `+00:00`. Vegeu backend/models/_datetime_utils.py.
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    workspace = relationship("Workspace")

class NotificationBase(BaseModel):
    title: str
    message: str
    level: str = "INFO"

class NotificationCreate(NotificationBase):
    workspace_id: str

class NotificationResponse(NotificationBase):
    id: str
    workspace_id: str
    is_read: bool
    created_at: datetime

    # Pydantic v2: ConfigDict instead of class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def _ser_created_at(self, v: datetime) -> str:
        return normalize_utc(v)
