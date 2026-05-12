from sqlalchemy import Column, String, DateTime, Text, Float
from datetime import datetime, timezone
import uuid
from backend.data.management_db import Base
from backend.models._datetime_utils import normalize_utc
from pydantic import BaseModel, ConfigDict, field_serializer
from typing import Optional

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

class TaskHistoryResponse(BaseModel):
    id: str
    task_name: str
    description: Optional[str]
    status: str
    message: Optional[str]
    started_at: datetime
    finished_at: Optional[datetime]
    duration_seconds: Optional[float]

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("started_at", "finished_at")
    def _ser_dt(self, v: Optional[datetime]) -> Optional[str]:
        return normalize_utc(v)
