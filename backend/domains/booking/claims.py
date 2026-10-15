"""Project durable booking claims onto owners and shared calendar resources."""

from datetime import datetime

from sqlalchemy.orm import Session

from backend.domains.booking.availability import BusyInterval, aware_utc
from backend.domains.booking.links import link_config
from backend.domains.booking.schemas import BookingSchedule
from backend.models.booking import BookingLink, BookingReservation
from backend.services.public_workflow_scope import resolve_private_vault
from backend.services.workspace_service import WorkspaceContext

CalendarResource = tuple[str, str, str]


def calendar_resources(
    schedule: BookingSchedule, workspace_id: str, vault_id: str,
) -> set[CalendarResource]:
    """A local calendar belongs to its pinned vault, not to the link's editor."""
    resources: set[CalendarResource] = set()
    for calendar in schedule.calendars:
        if calendar.provider == "vault":
            resources.add(("vault", workspace_id, vault_id))
        else:
            resources.add((calendar.provider, calendar.account.strip().casefold(), calendar.calendar_id))
    return resources


def reservation_busy(
    db: Session, context: WorkspaceContext, schedule: BookingSchedule,
    low: datetime, high: datetime,
) -> list[BusyInterval]:
    """Block shared resources while provider/file writes are pending or stale.

    Same-owner bookings remain mutually exclusive even when the links select
    different resources. Across owners, only intersecting selected resources
    conflict. Local resource identity includes both workspace and pinned vault.
    Booking-link configurations are immutable and survive link revocation.
    """
    vault_id = resolve_private_vault(db, context).id if any(
        calendar.provider == "vault" for calendar in schedule.calendars
    ) else ""
    selected = calendar_resources(schedule, context.workspace_id, vault_id)
    rows = db.query(BookingReservation, BookingLink).join(
        BookingLink, BookingReservation.link_id == BookingLink.id,
    ).filter(
        BookingReservation.workspace_id == context.workspace_id,
        BookingLink.workspace_id == context.workspace_id,
        BookingReservation.status.in_(("pending", "confirmed")),
        BookingReservation.blocked_start < high,
        BookingReservation.blocked_end > low,
    ).all()
    busy: list[BusyInterval] = []
    for reservation, link in rows:
        shared = reservation.owner_id == context.user_id or bool(selected.intersection(
            calendar_resources(link_config(link).schedule, link.workspace_id, link.vault_id),
        ))
        if shared:
            busy.append((aware_utc(reservation.blocked_start), aware_utc(reservation.blocked_end)))
    return busy
