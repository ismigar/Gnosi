"""Owner management and narrowly scoped public link lookup."""

from datetime import datetime, timedelta
import secrets

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.domains.booking.availability import UTC, aware_utc
from backend.domains.booking.schemas import BookingLinkCreate, BookingLinkResponse
from backend.models.booking import BookingLink, BookingReservation
from backend.services.public_workflow_scope import resolve_private_vault
from backend.services.workspace_service import WorkspaceContext


def load_public_link(db: Session, token: str) -> BookingLink:
    if len(token) != 64 or any(character not in "0123456789abcdef" for character in token):
        raise HTTPException(404, detail="Booking link unavailable")
    link = db.query(BookingLink).filter(BookingLink.token == token).first()
    if link is None or link.revoked or aware_utc(link.expires_at) <= datetime.now(UTC):
        raise HTTPException(404, detail="Booking link unavailable")
    return link


def link_config(link: BookingLink) -> BookingLinkCreate:
    return BookingLinkCreate.model_validate_json(link.config_json)


def describe_link(db: Session, link: BookingLink) -> BookingLinkResponse:
    config = link_config(link)
    pending = db.query(BookingReservation).filter(BookingReservation.link_id == link.id, BookingReservation.status == "pending").count()
    return BookingLinkResponse(
        id=link.id, token=link.token, title=link.title, schedule=config.schedule,
        destination=config.destination, expires_at=aware_utc(link.expires_at),
        revoked=link.revoked, pending_reservations=pending,
    )


def owner_links(db: Session, context: WorkspaceContext) -> list[BookingLink]:
    vault = resolve_private_vault(db, context)
    return db.query(BookingLink).filter(
        BookingLink.workspace_id == context.workspace_id,
        BookingLink.vault_id == vault.id,
        BookingLink.owner_id == context.user_id,
    ).order_by(BookingLink.created_at.desc()).limit(100).all()


def create_link(db: Session, context: WorkspaceContext, config: BookingLinkCreate) -> BookingLinkResponse:
    from backend.domains.booking.sources import validate_external_scope

    validate_external_scope(config.schedule, context)
    vault = resolve_private_vault(db, context)
    active_count = db.query(BookingLink).filter(
        BookingLink.workspace_id == context.workspace_id,
        BookingLink.owner_id == context.user_id,
        BookingLink.revoked.is_(False),
        BookingLink.expires_at > datetime.now(UTC),
    ).count()
    if active_count >= 100:
        raise HTTPException(409, detail="Revoke an existing booking link before creating another")
    link = BookingLink(
        token=secrets.token_hex(32), workspace_id=context.workspace_id,
        owner_id=context.user_id, vault_id=vault.id, title=config.title.strip(),
        config_json=config.model_dump_json(), expires_at=datetime.now(UTC) + timedelta(days=config.expires_days),
    )
    db.add(link)
    db.commit()
    return describe_link(db, link)


def revoke_link(db: Session, context: WorkspaceContext, link_id: str) -> None:
    vault = resolve_private_vault(db, context)
    link = db.query(BookingLink).filter(
        BookingLink.id == link_id, BookingLink.workspace_id == context.workspace_id,
        BookingLink.vault_id == vault.id, BookingLink.owner_id == context.user_id,
    ).first()
    if link is None:
        raise HTTPException(404, detail="Booking link unavailable")
    link.revoked = True
    db.commit()
