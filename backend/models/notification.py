from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from backend.data.management_db import Base
from backend.models.management import Workspace
from pydantic import BaseModel
from typing import Optional

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, ForeignKey("workspaces.id"), nullable=False, index=True)
    
    level = Column(String, default="INFO", nullable=False) # INFO, SUCCESS, WARNING, ERROR
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

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

    class Config:
        from_attributes = True
