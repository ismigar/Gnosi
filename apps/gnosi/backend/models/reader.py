from sqlalchemy import Boolean, Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from backend.data.db import Base
from backend.models._datetime_utils import normalize_utc
from pydantic import BaseModel, ConfigDict, field_serializer
from typing import Optional, List

# --- SQLAlchemy Models ---

class FeedSource(Base):
    __tablename__ = "feed_sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    url = Column(String, unique=True, index=True)
    category = Column(String, index=True)
    type = Column(String, default="rss") # rss, newsletter
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    articles = relationship("Article", back_populates="source", cascade="all, delete-orphan")

class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("feed_sources.id"))
    title = Column(String)
    url = Column(String, unique=True)
    # `content` is whatever the RSS feed shipped (often a short summary).
    # `full_content` is the article body extracted from the canonical URL
    # via trafilatura (set when the feed only ships an excerpt). The reader
    # frontend prefers `full_content` when present.
    content = Column(Text)
    full_content = Column(Text, nullable=True)
    published_at = Column(DateTime(timezone=True))
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    source = relationship("FeedSource", back_populates="articles")


class NewsletterAccount(Base):
    """POP3 mailbox configuration for newsletter ingestion (single row per vault)."""
    __tablename__ = "newsletter_account"

    id = Column(Integer, primary_key=True, index=True)
    mail_server = Column(String, default="")
    mail_port = Column(Integer, default=110)
    # 'starttls' | 'ssl' | 'none'
    mail_ssl = Column(String, default="starttls")
    email = Column(String, default="")
    password = Column(String, default="")  # stored plaintext locally; same vault as the rest of secrets
    delete_after_ingest = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

# --- Pydantic Schemas for API ---

class FeedSourceBase(BaseModel):
    name: str
    url: str
    category: Optional[str] = "Uncategorized"
    type: Optional[str] = "rss"

class FeedSourceCreate(FeedSourceBase):
    pass

class FeedSourceResponse(FeedSourceBase):
    id: int
    created_at: datetime

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at")
    def _ser_dt(self, v: datetime) -> str:
        return normalize_utc(v)

class ArticleBase(BaseModel):
    title: str
    url: str
    content: str
    published_at: Optional[datetime] = None

class ArticleCreate(ArticleBase):
    source_id: int

class ArticleResponse(ArticleBase):
    id: int
    source_id: int
    is_read: bool
    created_at: datetime
    source_name: Optional[str] = None
    full_content: Optional[str] = None

    # Pydantic v2: ConfigDict en lloc de class Config
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("created_at", "published_at")
    def _ser_dt(self, v: Optional[datetime]) -> Optional[str]:
        return normalize_utc(v)


class NewsletterAccountResponse(BaseModel):
    """Sanitized view of NewsletterAccount: never returns the password value."""
    mail_server: str = ""
    mail_port: int = 110
    mail_ssl: str = "starttls"
    email: str = ""
    delete_after_ingest: bool = True
    password_set: bool = False
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("updated_at")
    def _ser_dt(self, v: Optional[datetime]) -> Optional[str]:
        return normalize_utc(v)


class NewsletterAccountUpdate(BaseModel):
    """Payload for PUT /newsletter-account. Password is optional: only updates if provided."""
    mail_server: Optional[str] = None
    mail_port: Optional[int] = None
    mail_ssl: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    delete_after_ingest: Optional[bool] = None
