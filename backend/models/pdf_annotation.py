"""Persistent annotations for PDFs opened in the Vault viewer.

Each annotation is linked to the PDF via its canonical URI (file:// or
/api/vault/local-file/{token}). If the user physically moves the file, it loses
its annotations — this is an accepted limitation for the MVP. A future version
could add SHA-256 hashing to anchor to the content instead of the path.

The rectangle coordinates are **normalized** (0-1 relative to the
PDF viewport dimensions) so they stay stable across
zoom changes. They are serialized as JSON in the `rects_json` field to avoid
a child table with 1 row per rect.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.data.db import Base


class PdfAnnotation(Base):
    __tablename__ = "pdf_annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # canonical URI of the PDF (file://… or /api/vault/local-file/{token}).
    # Indexed because the most frequent query is "all the highlights
    # of this specific PDF".
    source_uri: Mapped[str] = mapped_column(String, index=True, nullable=False)
    # Page number, 1-indexed.
    page: Mapped[int] = mapped_column(Integer, nullable=False)
    # Annotation type. Expected values: 'highlight', 'underline',
    # 'strikeout', 'comment' (note anchored to a point), 'area' (rectangle
    # drawn on the page, e.g. to highlight an image).
    type: Mapped[str] = mapped_column(String, nullable=False)
    # Hex color including '#'. Default yellow, Zotero-style.
    color: Mapped[str | None] = mapped_column(String, default="#ffeb3b", nullable=True)
    # JSON-serialized list of rectangles. Format:
    #   [{"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.03}, ...]
    # In normalized 0-1 coordinates relative to the PDF page.
    rects_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Selected text (for highlights/underline/strikeout).
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Comment written by the user.
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Free-form tags separated by commas. For a future version with
    # filters in the sidebar.
    tags: Mapped[str | None] = mapped_column(String, nullable=True)
    # Stable key for annotations owned by a deterministic subsystem. Manual
    # reader annotations leave this null. LLM Wiki uses it to update or remove
    # its own highlights on reprocess without touching user annotations.
    managed_key: Mapped[str | None] = mapped_column(
        String,
        unique=True,
        index=True,
        nullable=True,
    )

    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=True,
    )
