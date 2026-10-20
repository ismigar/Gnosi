"""Availability aggregation and token-authorized booking endpoints."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.domains.booking.availability import UTC
from backend.domains.booking.links import create_link, describe_link, link_config, load_public_link, owner_links, revoke_link
from backend.domains.booking.reservations import make_reservation
from backend.domains.booking.schemas import (
    BookingAvailabilityRequest, BookingLinkCreate, BookingLinkResponse, BookingPublicInfo,
    BookingReservationRequest, BookingReservationResponse, BookingRevocationResponse, BookingSlotsResponse,
)
from backend.domains.booking.sources import slots_for_day, validate_external_scope
from backend.services.plugin_access import require_plugins
from backend.services.public_workflow_scope import public_vault_scope, resolve_private_vault
from backend.services.workspace_service import WorkspaceContext, require_role

router = APIRouter(prefix="/api/booking", tags=["Booking"])
_calendar = [Depends(require_plugins("calendar"))]


def _private(context: WorkspaceContext = Depends(require_role("editor"))) -> WorkspaceContext:
    return context


def _private_headers(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


@router.post("/availability", response_model=BookingSlotsResponse, dependencies=_calendar)
def availability(
    request: BookingAvailabilityRequest, response: Response,
    context: WorkspaceContext = Depends(_private), db: Session = Depends(get_mgmt_db),
) -> BookingSlotsResponse:
    _private_headers(response)
    resolve_private_vault(db, context)
    return slots_for_day(db, context, request.schedule, request.date)


@router.get("/links", response_model=list[BookingLinkResponse], dependencies=_calendar)
def list_links(
    response: Response, context: WorkspaceContext = Depends(_private), db: Session = Depends(get_mgmt_db),
) -> list[BookingLinkResponse]:
    _private_headers(response)
    return [describe_link(db, link) for link in owner_links(db, context)]


@router.post("/links", response_model=BookingLinkResponse, dependencies=_calendar)
def new_link(
    request: BookingLinkCreate, response: Response,
    context: WorkspaceContext = Depends(_private), db: Session = Depends(get_mgmt_db),
) -> BookingLinkResponse:
    _private_headers(response)
    return create_link(db, context, request)


@router.delete("/links/{link_id}", response_model=BookingRevocationResponse, dependencies=_calendar)
def delete_link(
    link_id: str, context: WorkspaceContext = Depends(_private), db: Session = Depends(get_mgmt_db),
) -> BookingRevocationResponse:
    revoke_link(db, context, link_id)
    return BookingRevocationResponse(revoked=True)


@router.get("/public/{token}", response_model=BookingPublicInfo)
def public_info(token: str, response: Response, db: Session = Depends(get_mgmt_db)) -> BookingPublicInfo:
    _private_headers(response)
    link = load_public_link(db, token)
    with public_vault_scope(db, link.workspace_id, link.vault_id, link.owner_id, plugin_ids=("calendar",)) as context:
        config = link_config(link)
        validate_external_scope(config.schedule, context)
        zone = ZoneInfo(config.schedule.timezone)
        first = datetime.now(UTC).astimezone(zone).date()
        last = first + timedelta(days=config.schedule.horizon_days)
        return BookingPublicInfo(title=link.title, timezone=config.schedule.timezone,
                                 duration_minutes=config.schedule.duration_minutes, first_date=first, last_date=last)


@router.get("/public/{token}/slots", response_model=BookingSlotsResponse)
def public_slots(
    token: str, response: Response, date: date = Query(...), db: Session = Depends(get_mgmt_db),
) -> BookingSlotsResponse:
    _private_headers(response)
    link = load_public_link(db, token)
    with public_vault_scope(db, link.workspace_id, link.vault_id, link.owner_id, plugin_ids=("calendar",)) as context:
        config = link_config(link)
        return slots_for_day(db, context, config.schedule, date)


@router.post("/public/{token}/reservations", response_model=BookingReservationResponse)
def public_reserve(
    token: str, request: BookingReservationRequest, response: Response, db: Session = Depends(get_mgmt_db),
) -> BookingReservationResponse:
    _private_headers(response)
    link = load_public_link(db, token)
    with public_vault_scope(db, link.workspace_id, link.vault_id, link.owner_id, plugin_ids=("calendar",)) as context:
        return make_reservation(db, token, request, context)
