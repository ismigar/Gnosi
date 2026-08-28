import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_serializer
from sqlalchemy import Column, DateTime, Float, String, Text

from backend.data.management_db import Base
from backend.models._datetime_utils import normalize_utc


class TaskExecutionHistory(Base):
    __tablename__ = "task_execution_history"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    task_name = Column(String, nullable=False, index=True)
    description = Column(String)
    status = Column(String, nullable=False) # running, success, error
    message = Column(Text)

    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    finished_at = Column(DateTime(timezone=True))
    duration_seconds = Column(Float)

class ScheduledTaskResponse(BaseModel):
    """Public scheduler task state."""

    name: str
    description: str
    interval_minutes: float
    enabled: bool
    last_run: str | None = None
    next_run: str | None = None
    status: str


class TaskUpdateResponse(BaseModel):
    """Result of updating a scheduler task."""

    success: Literal[True]
    task: ScheduledTaskResponse


class TaskRunResponse(BaseModel):
    """Acknowledgement for a manually queued scheduler task."""

    success: Literal[True]
    message: str
    status: Literal["running"]


class ClearTaskHistoryResponse(BaseModel):
    """Result of clearing scheduler execution history."""

    success: Literal[True]
    message: str


class TaskHistoryResponse(BaseModel):
    id: str
    task_name: str
    description: str | None
    status: str
    message: str | None
    started_at: datetime
    finished_at: datetime | None
    duration_seconds: float | None

    # Pydantic v2: ConfigDict instead of class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("started_at", "finished_at")
    def _ser_dt(self, v: datetime | None) -> str | None:
        return normalize_utc(v)


class TaskHistoryPageResponse(BaseModel):
    """Paginated scheduler execution history."""

    items: list[TaskHistoryResponse]
    total: int
    limit: int
    offset: int
    has_more: bool
