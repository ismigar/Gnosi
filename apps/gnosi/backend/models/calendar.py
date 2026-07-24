from sqlalchemy import Column, String, DateTime
from datetime import datetime, timezone
from backend.data.management_db import Base

class HiddenEvent(Base):
    """
        Stores the IDs of events that the user has decided to hide from the interface.
    Works both for Notion IDs (UUID) and Google Calendar IDs.
    
    """
    __tablename__ = "hidden_events"

    event_id = Column(String, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=True) # In case there is real multi-user support in the future
    hidden_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<HiddenEvent(event_id='{self.event_id}', hidden_at='{self.hidden_at}')>"
