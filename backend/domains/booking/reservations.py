"""Durable scheduling claims; uncertain writes stay blocked and are never retried."""

import asyncio
from datetime import timedelta
import hashlib
import uuid
from zoneinfo import ZoneInfo

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend.domains.booking.availability import aware_utc
from backend.domains.booking.links import link_config, load_public_link
from backend.domains.booking.schemas import BookingLinkCreate, BookingReservationRequest, BookingReservationResponse
from backend.domains.booking.sources import slots_for_day
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.models.booking import BookingReservation
from backend.services.workspace_service import WorkspaceContext


def reservation_response(row: BookingReservation) -> BookingReservationResponse:
    return BookingReservationResponse.model_validate({
        "id": row.id, "status": row.status, "start": aware_utc(row.start_at), "end": aware_utc(row.end_at),
    })


def _request_hash(request: BookingReservationRequest) -> str:
    normalized = request.model_copy(update={"start": aware_utc(request.start)})
    return hashlib.sha256(normalized.model_dump_json().encode()).hexdigest()


def claim_reservation(
    db: Session, token: str, request: BookingReservationRequest, context: WorkspaceContext,
) -> tuple[BookingReservation, BookingLinkCreate, bool]:
    """Serialize check+claim across processes before releasing the DB write lock.

    The management database is SQLite. BEGIN IMMEDIATE serializes owner and
    shared-calendar checks across links. A pending claim is durable before
    calling a remote provider or writing a vault file.
    """
    db.rollback()
    try:
        db.execute(text("BEGIN IMMEDIATE"))
        link = load_public_link(db, token)
        if link.workspace_id != context.workspace_id or link.owner_id != context.user_id:
            raise HTTPException(404, detail="Booking link unavailable")
        config = link_config(link)
        fingerprint = _request_hash(request)
        existing = db.query(BookingReservation).filter(
            BookingReservation.link_id == link.id,
            BookingReservation.idempotency_key == request.idempotency_key,
        ).first()
        if existing is not None:
            if existing.request_hash != fingerprint:
                raise HTTPException(409, detail="Booking request key already belongs to different data")
            db.commit()
            return existing, config, False
        start = aware_utc(request.start)
        day = start.astimezone(ZoneInfo(config.schedule.timezone)).date()
        available = slots_for_day(db, context, config.schedule, day)
        slot = next((slot for slot in available.slots if slot.start == start), None)
        if slot is None:
            raise HTTPException(409, detail="This time is no longer available")
        buffer = timedelta(minutes=config.schedule.buffer_minutes)
        row = BookingReservation(
            id=uuid.uuid4().hex, link_id=link.id, workspace_id=context.workspace_id,
            owner_id=context.user_id, idempotency_key=request.idempotency_key, request_hash=fingerprint,
            start_at=slot.start, end_at=slot.end, blocked_start=slot.start - buffer,
            blocked_end=slot.end + buffer, name=request.name, email=request.email, status="pending",
        )
        db.add(row)
        db.commit()
        return row, config, True
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(503, detail="Booking is busy; retry the same request") from exc
    except Exception:
        db.rollback()
        raise


async def _create_local(row: BookingReservation, config: BookingLinkCreate, context: WorkspaceContext) -> str:
    from backend.api.vault_routes import create_page

    tasks = BackgroundTasks()
    result = await create_page(
        PageSaveRequest(
            title=f"{config.title} · {row.name}", content="",
            metadata={
                "date": aware_utc(row.start_at).isoformat(), "end_date": aware_utc(row.end_at).isoformat(),
                "all_day": False, "source": "Gnosi", "type": "event",
                "attendees": [{"email": row.email, "displayName": row.name}],
                "booking_reservation_id": row.id,
            },
        ), tasks, context=context, idempotency_key=f"booking-{row.id}",
    )
    await tasks()
    page_id = result.get("id")
    if not isinstance(page_id, str) or not page_id:
        raise RuntimeError("Local booking creation did not confirm a page")
    return page_id


def _write_event(row: BookingReservation, config: BookingLinkCreate, context: WorkspaceContext) -> str:
    if config.destination.provider == "vault":
        return asyncio.run(_create_local(row, config, context))
    from backend.domains.calendar.provider_operations import create_provider_event

    result = create_provider_event(
        config.destination.account, config.destination.calendar_id,
        {
            "provider": config.destination.provider,
            "summary": f"{config.title} · {row.name}",
            "start": {"dateTime": aware_utc(row.start_at).isoformat(), "timeZone": config.schedule.timezone},
            "end": {"dateTime": aware_utc(row.end_at).isoformat(), "timeZone": config.schedule.timezone},
            "attendees": [{"email": row.email, "displayName": row.name}],
        }, stable_id=row.id,
    )
    event_id = result.get("id")
    if not isinstance(event_id, str) or not event_id:
        raise RuntimeError("Provider did not confirm an event")
    return event_id


def make_reservation(
    db: Session, token: str, request: BookingReservationRequest, context: WorkspaceContext,
) -> BookingReservationResponse:
    row, config, fresh = claim_reservation(db, token, request, context)
    if not fresh:
        return reservation_response(row)
    try:
        row.event_id = _write_event(row, config, context)
        row.status = "confirmed"
    except Exception as exc:
        # Only a provider's definite rejection can release the claim. An unknown
        # remote or local outcome remains pending, even after a server restart.
        from backend.domains.calendar.provider_errors import CalendarProviderError

        if isinstance(exc, CalendarProviderError) and not exc.outcome_unknown:
            row.status = "failed"
        db.commit()
        return reservation_response(row)
    db.commit()
    from backend.domains.calendar.runtime import EVENTS_CACHE

    EVENTS_CACHE.clear()
    return reservation_response(row)
