"""Scoped read adapters for first-party Gnosi data modules.

Internal sources expose bounded inventory, search, and exact-read operations.
They never grant mutation rights: writes remain governed agent tools.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

from backend.config.logger_config import get_logger
from backend.domains.agent.sources import integrations as integration_sources
from backend.domains.agent.sources import optional as optional_sources
from backend.domains.agent.sources import planning as planning_sources
from backend.domains.agent.sources import reader as reader_sources
from backend.domains.agent.sources import references as reference_sources
from backend.domains.agent.sources import scopes as source_scopes

log = get_logger(__name__)

# Explicit compatibility exports. Runtime collaborators below remain local so
# historical monkeypatches on this module continue to affect canonical adapters.
INTERNAL_SOURCE_IDS = source_scopes.INTERNAL_SOURCE_IDS
DEFAULT_RESULT_ITEMS = source_scopes.DEFAULT_RESULT_ITEMS
MAX_CALENDAR_DAYS = source_scopes.MAX_CALENDAR_DAYS
MAX_EXCERPT_CHARS = source_scopes.MAX_EXCERPT_CHARS
MAX_RECORD_CHARS = source_scopes.MAX_RECORD_CHARS
MAX_RESULT_ITEMS = source_scopes.MAX_RESULT_ITEMS
MAX_RESULT_OFFSET = source_scopes.MAX_RESULT_OFFSET
MAX_SCOPE_ITEMS = source_scopes.MAX_SCOPE_ITEMS
READER_READ_STATUSES = source_scopes.READER_READ_STATUSES
_SPACE_RE = source_scopes._SPACE_RE
_TAG_RE = source_scopes._TAG_RE
_apply_reader_scope = source_scopes._apply_reader_scope
_bounded_ints = source_scopes._bounded_ints
_bounded_json_value = source_scopes._bounded_json_value
_bounded_strings = source_scopes._bounded_strings
_iso_datetime = source_scopes._iso_datetime
_plain_text = source_scopes._plain_text
intersect_reader_scope = source_scopes.intersect_reader_scope
normalize_internal_scope = source_scopes.normalize_internal_scope
reader_scope_contains = source_scopes.reader_scope_contains

_article_payload = reader_sources._article_payload
_reader_inventory = reader_sources._reader_inventory
_reader_read = reader_sources._reader_read
_reader_search = reader_sources._reader_search

_calendar_rows = integration_sources._calendar_rows
_calendar_search = integration_sources._calendar_search
_contacts_read = integration_sources._contacts_read
_contacts_search = integration_sources._contacts_search
_mail_read = integration_sources._mail_read
_mail_search = integration_sources._mail_search
_run_async = integration_sources._run_async

_planning_inventory = planning_sources._planning_inventory
_planning_read = planning_sources._planning_read
_planning_records = planning_sources._planning_records
_planning_search = planning_sources._planning_search

_metadata_value = reference_sources._metadata_value
_reference_page_body = reference_sources._reference_page_body
_reference_pages = reference_sources._reference_pages
_reference_payload = reference_sources._reference_payload
_references_inventory = reference_sources._references_inventory
_references_read = reference_sources._references_read
_references_search = reference_sources._references_search

_meeting_pages = optional_sources._meeting_pages
_meeting_payload = optional_sources._meeting_payload
_meetings_inventory = optional_sources._meetings_inventory
_meetings_read = optional_sources._meetings_read
_meetings_search = optional_sources._meetings_search
_notion_client = optional_sources._notion_client
_notion_inventory = optional_sources._notion_inventory
_notion_read = optional_sources._notion_read
_notion_records = optional_sources._notion_records
_notion_search = optional_sources._notion_search
_social_inventory = optional_sources._social_inventory
_social_read = optional_sources._social_read
_social_records = optional_sources._social_records
_social_search = optional_sources._social_search
INTERNAL_SOURCE_PLUGINS = {
    "reader": ("feeds-reader",),
    "mail": ("mail",),
    "calendar": ("calendar",),
    "contacts": ("contacts",),
    "planning": ("project-planning",),
    "social": ("social-publishing",),
    "meetings": ("calendar", "ai-platform"),
    "notion": ("notion-import",),
}


def _internal_source_enabled(source_id: str) -> bool:
    """Return whether this source's optional capabilities are active."""
    required = INTERNAL_SOURCE_PLUGINS.get(str(source_id or "").strip().lower(), ())
    if not required:
        return True
    from backend.domains.vault.api.configuration_routes import _load_plugins_state
    from backend.services import builtin_plugins

    state = _load_plugins_state()
    return all(builtin_plugins.is_enabled(state, plugin_id) for plugin_id in required)


def _assert_internal_source_enabled(source_id: str) -> None:
    """Reject new reads from sources whose plugins are paused."""
    if not _internal_source_enabled(source_id):
        raise PermissionError(f"Internal source is disabled: {source_id}")


def _request_scope() -> Dict[str, str]:
    """Resolve the authenticated chat execution scope or fail closed."""
    from backend.agent.action_confirmations import current_confirmation_scope

    return current_confirmation_scope()


def _workspace_id() -> str:
    return _request_scope()["workspace_id"]


def _assert_personal_workspace() -> None:
    if _workspace_id() != "personal":
        raise PermissionError(
            "Installation-global integrations are unavailable outside the personal workspace."
        )


def _configured_accounts(*, calendar: bool = False) -> List[str]:
    """Return enabled, credential-free configured account identifiers."""
    from backend.services.integration_manager import integration_manager

    safe = integration_manager.get_all_safe()
    sections = (
        ("calendars", "emails", "mail_accounts")
        if calendar
        else (
            "emails",
            "mail_accounts",
        )
    )
    accounts: List[str] = []
    for section in sections:
        for item in safe.get(section, []) or []:
            if not isinstance(item, dict) or item.get("enabled", True) is False:
                continue
            account = str(item.get("email") or item.get("username") or "").strip().lower()
            if account and account not in accounts:
                accounts.append(account)
    return accounts


def _allowed_accounts(requested: Iterable[str], *, calendar: bool = False) -> List[str]:
    _assert_personal_workspace()
    configured = _configured_accounts(calendar=calendar)
    requested_values = [str(value).strip().lower() for value in requested if str(value).strip()]
    if not requested_values:
        return configured
    unknown = sorted(set(requested_values) - set(configured))
    if unknown:
        raise PermissionError("The requested integration account is unavailable.")
    return list(dict.fromkeys(requested_values))


def _reader_session() -> Any:
    from backend.data.db import get_engine_for_path
    from backend.services.context_vars import get_active_vault_path

    vault_path = get_active_vault_path()
    if vault_path is None:
        raise RuntimeError("There is no active Vault.")
    _engine, session_factory = get_engine_for_path(vault_path)
    return session_factory()


def _planning_snapshot() -> Dict[str, Any]:
    """Load authoritative planning state and rebuildable schedule for one Vault."""
    from backend.services.context_vars import get_active_vault_path
    from backend.services.planning_engine import ScheduleIndex
    from backend.services.project_planning import PlanningStore, calculate_allocation

    active_vault_path = get_active_vault_path()
    if active_vault_path is None:
        raise RuntimeError("There is no active Vault.")
    vault_path = active_vault_path.resolve()
    state = PlanningStore(vault_path / ".gnosi").load()
    schedule = ScheduleIndex(vault_path).load() or {"projects": {}}
    return {
        "state": state,
        "schedule": schedule,
        "allocation": calculate_allocation(state),
    }


def _reference_table() -> Optional[Dict[str, Any]]:
    """Resolve the deliberately configured References table in this Vault."""
    from backend.api.vault_routes import load_registry
    from backend.services.reference_table_config import (
        CONFIG_PATH,
        DEFAULT_CONFIG,
        load_json,
    )

    config = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
    table_id = str(config.get("target_table") or "").strip()
    if not table_id:
        return None
    typed_load_registry = cast(Callable[[], Dict[str, Any]], load_registry)
    return next(
        (
            table
            for table in (typed_load_registry().get("tables") or [])
            if str(table.get("id") or "") == table_id
        ),
        None,
    )


def describe_internal_source(source_id: str, raw_scope: Any) -> str:
    """Return a bounded inventory for a scoped internal source."""
    source_id = str(source_id or "").strip().lower()
    _assert_internal_source_enabled(source_id)
    scope = normalize_internal_scope(source_id, raw_scope)
    if source_id == "reader":
        payload = _reader_inventory(scope)
    elif source_id == "mail":
        payload = {
            "source": "mail",
            "accounts": _allowed_accounts(scope["accounts"]),
            "folder": scope["folder"],
        }
    elif source_id == "calendar":
        payload = {
            "source": "calendar",
            "accounts": _allowed_accounts(scope["accounts"], calendar=True),
            "date_from": scope["date_from"],
            "date_to": scope["date_to"],
        }
    elif source_id == "planning":
        payload = _planning_inventory(scope)
    elif source_id == "references":
        payload = _references_inventory(scope)
    elif source_id == "social":
        payload = _social_inventory(scope)
    elif source_id == "meetings":
        payload = _meetings_inventory(scope)
    elif source_id == "notion":
        payload = _notion_inventory(scope)
    else:
        payload = _contacts_search(scope, "")
        payload["count"] = len(payload.pop("records", []))
    return json.dumps(payload, ensure_ascii=False, default=str)


def search_internal_source(source_id: str, raw_scope: Any, query: str) -> str:
    """Search one scoped internal source and return bounded JSON records."""
    source_id = str(source_id or "").strip().lower()
    _assert_internal_source_enabled(source_id)
    scope = normalize_internal_scope(source_id, raw_scope)
    if source_id == "reader":
        payload = _reader_search(scope, query)
    elif source_id == "mail":
        payload = _mail_search(scope, query)
    elif source_id == "calendar":
        payload = _calendar_search(scope, query)
    elif source_id == "planning":
        payload = _planning_search(scope, query)
    elif source_id == "references":
        payload = _references_search(scope, query)
    elif source_id == "social":
        payload = _social_search(scope, query)
    elif source_id == "meetings":
        payload = _meetings_search(scope, query)
    elif source_id == "notion":
        payload = _notion_search(scope, query)
    else:
        payload = _contacts_search(scope, query)
    return json.dumps(payload, ensure_ascii=False, default=str)


def read_internal_record(source_id: str, raw_scope: Any, record_id: str) -> str:
    """Read one exact record that remains inside the configured source scope."""
    source_id = str(source_id or "").strip().lower()
    _assert_internal_source_enabled(source_id)
    scope = normalize_internal_scope(source_id, raw_scope)
    if source_id == "reader":
        payload = _reader_read(scope, record_id)
    elif source_id == "mail":
        payload = _mail_read(scope, record_id)
    elif source_id == "calendar":
        rows = _calendar_rows(scope, "")
        calendar_payload = next(
            (row for row in rows if str(row.get("id")) == str(record_id)),
            None,
        )
        if calendar_payload is None:
            raise KeyError(record_id)
        payload = calendar_payload
    elif source_id == "planning":
        payload = _planning_read(scope, record_id)
    elif source_id == "references":
        payload = _references_read(scope, record_id)
    elif source_id == "social":
        payload = _social_read(scope, record_id)
    elif source_id == "meetings":
        payload = _meetings_read(scope, record_id)
    elif source_id == "notion":
        payload = _notion_read(scope, record_id)
    else:
        payload = _contacts_read(scope, record_id)
    return json.dumps(payload, ensure_ascii=False, default=str)


def _base_source_descriptors() -> List[Dict[str, Any]]:
    return [
        {
            "id": "reader",
            "name": "Reader",
            "description": "Unread and historical feed or newsletter articles.",
            "scope": {
                "unread_only": True,
                "source_ids": [],
                "categories": [],
                "date_from": "",
                "date_to": "",
                "include_full_content": False,
            },
            "options": {"sources": [], "categories": []},
        },
        {
            "id": "mail",
            "name": "Mail",
            "description": "Bounded headers, previews, and exact messages.",
            "scope": {"accounts": [], "folder": "INBOX"},
            "options": {"accounts": []},
        },
        {
            "id": "calendar",
            "name": "Calendars",
            "description": "Events inside a bounded time range.",
            "scope": {"accounts": [], "calendar_ids": [], "include_vault": True},
            "options": {"accounts": []},
        },
        {
            "id": "contacts",
            "name": "Contacts",
            "description": "Workspace contacts with optional source and type filters.",
            "scope": {"sources": [], "types": []},
            "options": {"sources": ["local", "google", "apple"], "types": ["personal", "b2b"]},
        },
        {
            "id": "planning",
            "name": "Planning",
            "description": "Vault projects, tasks, resources, assignments, and schedules.",
            "scope": {
                "entity_types": [],
                "project_ids": [],
                "resource_ids": [],
                "include_inactive": False,
            },
            "options": {
                "entity_types": [
                    "project",
                    "task",
                    "resource",
                    "assignment",
                    "calendar",
                    "recurrence",
                ],
                "projects": [],
                "resources": [],
            },
        },
    ]


def _populate_reader_options(descriptors: List[Dict[str, Any]]) -> None:
    try:
        if not _internal_source_enabled("reader"):
            raise PermissionError("Reader plugin is disabled")
        db = _reader_session()
        try:
            from backend.models.reader import FeedSource

            feeds = db.query(FeedSource).order_by(FeedSource.name).all()
            descriptors[0]["options"]["sources"] = [
                {"id": feed.id, "name": feed.name, "category": feed.category} for feed in feeds
            ]
            descriptors[0]["options"]["categories"] = sorted(
                {str(feed.category) for feed in feeds if feed.category}
            )
        finally:
            db.close()
    except PermissionError:
        pass
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build Reader source options: %s", error)


def _populate_planning_options(descriptors: List[Dict[str, Any]]) -> None:
    try:
        if not _internal_source_enabled("planning"):
            raise PermissionError("Planning plugin is disabled")
        planning = _planning_snapshot()
        projects = planning["schedule"].get("projects") or {}
        descriptors[4]["options"]["projects"] = [
            {
                "id": str(project_id),
                "name": str(project.get("title") or project_id),
            }
            for project_id, project in projects.items()
        ]
        descriptors[4]["options"]["resources"] = [
            {"id": str(resource.get("id")), "name": str(resource.get("name") or "")}
            for resource in planning["state"].get("resources") or []
            if resource.get("id")
        ]
    except PermissionError:
        pass
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build Planning source options: %s", error)


def _append_reference_descriptor(descriptors: List[Dict[str, Any]]) -> None:
    try:
        table = _reference_table()
        if table:
            reference_scope = normalize_internal_scope("references", {})
            reference_pages = _reference_pages(reference_scope)
            descriptors.append(
                {
                    "id": "references",
                    "name": "References",
                    "description": (
                        "Configured bibliographic references and exact evidence records."
                    ),
                    "scope": {"item_types": [], "languages": []},
                    "options": {
                        "item_types": sorted(
                            {
                                str(_reference_payload(page).get("item_type") or "")
                                for page in reference_pages
                                if _reference_payload(page).get("item_type")
                            }
                        ),
                        "languages": sorted(
                            {
                                str(_reference_payload(page).get("language") or "")
                                for page in reference_pages
                                if _reference_payload(page).get("language")
                            }
                        ),
                    },
                }
            )
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build References source options: %s", error)


def _append_meeting_descriptor(descriptors: List[Dict[str, Any]]) -> None:
    try:
        if not _internal_source_enabled("meetings"):
            raise PermissionError("Meeting capabilities are disabled")
        meeting_scope = normalize_internal_scope("meetings", {})
        if _meeting_pages(meeting_scope):
            descriptors.append(
                {
                    "id": "meetings",
                    "name": "Meetings",
                    "description": "Recorded meeting minutes and exact transcripts in this Vault.",
                    "scope": {"date_from": "", "date_to": ""},
                    "options": {},
                }
            )
    except PermissionError:
        pass
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build Meetings source options: %s", error)


def _append_notion_descriptor(descriptors: List[Dict[str, Any]]) -> None:
    try:
        if not _internal_source_enabled("notion"):
            raise PermissionError("Notion plugin is disabled")
        from backend.api.notion_routes import _get_token
        from backend.services.notion_importer import _plain_title

        if not _get_token():
            return
        databases = _notion_client().search_databases()
        descriptors.append(
            {
                "id": "notion",
                "name": "Notion",
                "description": "Pages and databases shared with the connected Notion integration.",
                "scope": {"object_types": [], "database_ids": []},
                "options": {
                    "object_types": ["database", "page"],
                    "databases": [
                        {
                            "id": str(item.get("id") or ""),
                            "name": _plain_title(item.get("title")) or "Untitled",
                        }
                        for item in databases[:100]
                    ],
                },
            }
        )
    except PermissionError:
        pass
    except Exception as error:  # noqa: BLE001
        log.warning("Could not build Notion source options: %s", error)


def _append_social_descriptor(descriptors: List[Dict[str, Any]]) -> None:
    if not _internal_source_enabled("social"):
        return
    descriptors.append(
        {
            "id": "social",
            "name": "Social",
            "description": "Saved drafts, scheduled posts, and publication history.",
            "scope": {"networks": [], "statuses": []},
            "options": {
                "networks": ["mastodon", "bluesky", "linkedin", "facebook", "telegram"],
                "statuses": [
                    "esborrany",
                    "programada",
                    "publicant",
                    "publicada",
                    "parcial",
                    "error",
                    "cancelada",
                ],
            },
        }
    )


def _populate_personal_options(descriptors: List[Dict[str, Any]]) -> None:
    if _internal_source_enabled("mail"):
        descriptors[1]["options"]["accounts"] = _configured_accounts()
    if _internal_source_enabled("calendar"):
        descriptors[2]["options"]["accounts"] = _configured_accounts(calendar=True)
    _append_notion_descriptor(descriptors)
    _append_social_descriptor(descriptors)


def internal_source_catalog(workspace_id: str) -> List[Dict[str, Any]]:
    """Return source descriptors and safe scope options for Settings."""
    descriptors = _base_source_descriptors()
    _populate_reader_options(descriptors)
    _populate_planning_options(descriptors)
    _append_reference_descriptor(descriptors)
    _append_meeting_descriptor(descriptors)
    if workspace_id == "personal":
        _populate_personal_options(descriptors)
    else:
        allowed = {"reader", "contacts", "planning", "references", "meetings"}
        descriptors = [item for item in descriptors if item["id"] in allowed]
    return [item for item in descriptors if _internal_source_enabled(item["id"])]
