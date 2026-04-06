from sqlalchemy import Boolean, Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from backend.data.db import Base
from pydantic import BaseModel
from typing import Optional, List

# --- SQLAlchemy Models ---

class FeedSource(Base):
    __tablename__ = "feed_sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    url = Column(String, unique=True, index=True)
    category = Column(String, index=True)
    type = Column(String, default="rss") # rss, newsletter
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    articles = relationship("Article", back_populates="source", cascade="all, delete-orphan")

class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("feed_sources.id"))
    title = Column(String)
    url = Column(String, unique=True)
    content = Column(Text)
    published_at = Column(DateTime)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    source = relationship("FeedSource", back_populates="articles")

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
    
    class Config:
        from_attributes = True

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

    class Config:
        from_attributes = True
