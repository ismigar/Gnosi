"""Governed adapters for exact calendar reads and external mutations."""
from __future__ import annotations

import json
from typing import Any, Dict, List

try:
    from langchain_core.tools import tool
except Exception:  # pragma: no cover
    def tool(fn=None, **_kwargs):
        return fn if fn else (lambda function: function)


def _account(account: str) -> str:
    from backend.agent.gnosi_tools import _assert_global_integration_access

    return _assert_global_integration_access(account, calendar=True)


@tool
async def read_calendar_event(
    account: str,
    event_id: str,
    calendar_id: str = "primary",
) -> str:
    """Read one exact event from one configured calendar account."""
    from backend.agent.gnosi_tools import _bounded_json_value
    from backend.api.calendar_routes import get_event

    result = await get_event(
        event_id, email=_account(account), calendar_id=calendar_id
    )
    return json.dumps(_bounded_json_value(result), ensure_ascii=False, default=str)


@tool
async def calendar_free_busy(
    account: str,
    time_min: str,
    time_max: str,
    calendar_ids: List[str] | None = None,
) -> str:
    """Read busy intervals in an exact ISO-8601 time range."""
    from backend.api.calendar_routes import post_freebusy

    result = await post_freebusy(
        email=_account(account),
        time_min=time_min,
        time_max=time_max,
        calendar_ids=calendar_ids or None,
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def update_calendar_event(
    account: str,
    event_id: str,
    changes: Dict[str, Any],
    calendar_id: str = "primary",
) -> str:
    """Update one external calendar event after interactive confirmation."""
    from backend.api.calendar_routes import patch_event

    allowed = {
        "summary", "title", "description", "location", "start", "end",
        "date", "end_date", "all_day", "recurrence", "attendees",
    }
    patch = {key: value for key, value in changes.items() if key in allowed}
    if not patch:
        raise ValueError("No supported calendar changes were provided.")
    result = await patch_event(
        event_id,
        email=_account(account),
        calendar_id=calendar_id,
        patch_data=patch,
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def delete_calendar_event(
    account: str,
    event_id: str,
    calendar_id: str = "primary",
) -> str:
    """Delete one external calendar event after interactive confirmation."""
    from backend.api.calendar_routes import delete_event

    result = await delete_event(
        event_id,
        email=_account(account),
        calendar_id=calendar_id,
        vault_path=None,
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def rsvp_calendar_event(
    account: str,
    event_id: str,
    response: str,
    calendar_id: str = "primary",
) -> str:
    """Respond to one calendar invitation after interactive confirmation."""
    from backend.api.calendar_routes import rsvp_event

    result = await rsvp_event(
        event_id,
        {
            "email": _account(account),
            "calendar_id": calendar_id,
            "rsvp": response,
        },
    )
    return json.dumps(result, ensure_ascii=False, default=str)


CALENDAR_READ_TOOLS = [read_calendar_event, calendar_free_busy]
CALENDAR_EXTERNAL_WRITE_TOOLS = [
    update_calendar_event,
    delete_calendar_event,
    rsvp_calendar_event,
]
