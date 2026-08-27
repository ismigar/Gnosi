"""
Scheduled Posts Model
Defines the database model for storing scheduled social media posts.
"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class ScheduledPost(BaseModel):
    """A post scheduled for future publication."""
    id: str
    content: str
    networks: List[str]
    scheduled_time: datetime
    created_at: datetime
    status: str = "pending"  # pending, published, failed, cancelled
    published_at: Optional[datetime] = None
    error_message: Optional[str] = None


class ScheduledPostCreate(BaseModel):
    """Request model for creating a scheduled post."""
    content: str
    networks: List[str]
    scheduled_time: datetime


class ScheduledPostResponse(BaseModel):
    """Response after scheduling a post."""
    id: str
    scheduled_time: datetime
    networks: List[str]
    status: str
