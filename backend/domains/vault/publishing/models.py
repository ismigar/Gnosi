"""Management-database storage; published bodies never consult live Vault files."""

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.data.management_db import Base


class PublicationPreview(Base):
    __tablename__ = "publication_previews"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String, index=True)
    workspace_id: Mapped[str] = mapped_column(String)
    vault_key: Mapped[str] = mapped_column(String)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)
    payload: Mapped[str] = mapped_column(Text)
    source_ids: Mapped[str] = mapped_column(Text)
    site_id: Mapped[str | None] = mapped_column(String, nullable=True)
    expected_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PublicationSite(Base):
    __tablename__ = "publication_sites"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    token: Mapped[str] = mapped_column(String, unique=True, index=True)
    owner_id: Mapped[str] = mapped_column(String, index=True)
    workspace_id: Mapped[str] = mapped_column(String)
    vault_key: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    source_ids: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PublicationRevision(Base):
    __tablename__ = "publication_revisions"

    site_id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    payload: Mapped[str] = mapped_column(Text)
