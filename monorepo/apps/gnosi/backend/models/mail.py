from sqlalchemy import Column, String, Integer, Text, Boolean
from pydantic import BaseModel
from typing import Optional, List
from backend.data.db import Base

class MailMessage(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, index=True)
    thread_id = Column(String, index=True)
    account_email = Column(String, index=True)
    subject = Column(String)
    sender = Column(String)
    recipient = Column(String)
    cc = Column(String)
    bcc = Column(String)
    date = Column(String)
    timestamp = Column(Integer)
    body_text = Column(Text)
    body_html = Column(Text)
    snippet = Column(String)
    is_read = Column(Boolean, default=False)
    is_starred = Column(Boolean, default=False)
    category = Column(String)
    labels = Column(String) # Comma separated
    raw_json = Column(Text)

# Pydantic Schemas
class MailMessageSchema(BaseModel):
    id: str
    thread_id: str
    account_email: str
    subject: str
    sender: str
    recipient: str
    cc: Optional[str]
    bcc: Optional[str]
    date: str
    timestamp: int
    body_text: Optional[str]
    body_html: Optional[str]
    snippet: Optional[str]
    is_read: bool
    is_starred: bool
    category: Optional[str]
    labels: Optional[str]

    class Config:
        from_attributes = True

class MailUpdateSchema(BaseModel):
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None
    category: Optional[str] = None
    labels: Optional[str] = None
