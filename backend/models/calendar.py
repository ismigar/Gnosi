from sqlalchemy import Column, String, DateTime
from datetime import datetime, timezone
from backend.data.management_db import Base

class HiddenEvent(Base):
    """
    Guarda els IDs d'esdeveniments que l'usuari ha decidit amagar de la interfície.
    Funciona tant per a IDs de Notion (UUID) com per a IDs de Google Calendar.
    """
    __tablename__ = "hidden_events"

    event_id = Column(String, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=True) # Per si en el futur hi ha multi-usuari real
    hidden_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f"<HiddenEvent(event_id='{self.event_id}', hidden_at='{self.hidden_at}')>"
