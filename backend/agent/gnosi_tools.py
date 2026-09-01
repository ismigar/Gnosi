"""Compatibility facade for stable first-party Gnosi tools.

Canonical implementations live under :mod:`backend.domains.agent`. The facade
keeps historical imports and explicit monkeypatch seams stable.
"""

from __future__ import annotations

import sys
import tempfile as tempfile
import types
from typing import Any

from backend.domains.agent import gnosi_confirmations as confirmations
from backend.domains.agent import gnosi_dispatch as dispatch
from backend.domains.agent import gnosi_dispatch_basic as dispatch_basic
from backend.domains.agent import gnosi_dispatch_rows as dispatch_rows
from backend.domains.agent import gnosi_dispatch_tables as dispatch_tables
from backend.domains.agent import gnosi_integrations as integrations
from backend.domains.agent import gnosi_mutation as mutation
from backend.domains.agent import gnosi_support as support
from backend.domains.agent import gnosi_vault_tools as vault_tools

ActionConflictError = support.ActionConflictError
MAX_BODY_CHARS = support.MAX_BODY_CHARS
MAX_CONFIRMATION_SAMPLE_ITEMS = support.MAX_CONFIRMATION_SAMPLE_ITEMS
MAX_DETERMINISTIC_BULK_ITEMS = support.MAX_DETERMINISTIC_BULK_ITEMS
MAX_LIST_ITEMS = support.MAX_LIST_ITEMS
MAX_REFERENCE_TABLES = support.MAX_REFERENCE_TABLES
_BULK_UPDATE_LOCK = support._BULK_UPDATE_LOCK
_UUID_RE = support._UUID_RE
_assert_global_integration_access = support._assert_global_integration_access
_bounded_json_value = support._bounded_json_value
_bounded_limit = support._bounded_limit
_confirmation = support._confirmation
_confirmation_scope = support._confirmation_scope
_contact_snapshot = support._contact_snapshot
_file_revision = support._file_revision
_json = support._json
_mail_message_preview = support._mail_message_preview
_mail_message_snapshot = support._mail_message_snapshot
_page_files = support._page_files
_parse = support._parse
_reference_title_replacement_plan = support._reference_title_replacement_plan
_require_file_revision = support._require_file_revision
_require_mail_message_revision = support._require_mail_message_revision
_resolve_page = support._resolve_page
_resolve_snapshotted_row_path = support._resolve_snapshotted_row_path
_rollback_page_items = support._rollback_page_items
_serialize_page = support._serialize_page
_table = support._table
_table_delete_snapshot = support._table_delete_snapshot
_table_folder = support._table_folder
_table_rows_snapshot = support._table_rows_snapshot
_trash_snapshot = support._trash_snapshot
_value_revision = support._value_revision
_vault = support._vault
_workspace_id = support._workspace_id
_write_page = support._write_page

_PAGE_LOCKS = mutation._PAGE_LOCKS
_PAGE_LOCKS_GUARD = mutation._PAGE_LOCKS_GUARD
_mutate_page = mutation._mutate_page
_page_lock = mutation._page_lock

add_page_comment = vault_tools.add_page_comment
add_tags = vault_tools.add_tags
append_to_page = vault_tools.append_to_page
create_table_row = vault_tools.create_table_row
delete_page = vault_tools.delete_page
find_pages_by_tag = vault_tools.find_pages_by_tag
get_page_history = vault_tools.get_page_history
get_page_links = vault_tools.get_page_links
get_table_row = vault_tools.get_table_row
list_table_rows = vault_tools.list_table_rows
list_tags = vault_tools.list_tags
mark_task_complete = vault_tools.mark_task_complete
update_page = vault_tools.update_page
update_table_row = vault_tools.update_table_row

archive_mail = integrations.archive_mail
create_calendar_event = integrations.create_calendar_event
create_contact = integrations.create_contact
delete_contact = integrations.delete_contact
invite_attendees = integrations.invite_attendees
list_calendar_events = integrations.list_calendar_events
list_contacts = integrations.list_contacts
move_mail = integrations.move_mail
save_mail_draft = integrations.save_mail_draft
search_mail = integrations.search_mail
send_mail = integrations.send_mail

bulk_update_rows = confirmations.bulk_update_rows
change_schema = confirmations.change_schema
delete_table = confirmations.delete_table
empty_trash = confirmations.empty_trash
replace_reference_ids_in_titles = confirmations.replace_reference_ids_in_titles
restore_page_version = confirmations.restore_page_version
execute_confirmed_action = dispatch.execute_confirmed_action

READ_TOOLS = vault_tools.READ_TOOLS
EXPLICIT_WRITE_TOOLS = vault_tools.EXPLICIT_WRITE_TOOLS
CONFIRMED_WRITE_TOOLS = vault_tools.CONFIRMED_WRITE_TOOLS
READ_TOOLS.extend([list_calendar_events, search_mail, list_contacts])
EXPLICIT_WRITE_TOOLS.append(create_contact)
CONFIRMED_WRITE_TOOLS.extend([create_calendar_event, save_mail_draft])
CONFIRMED_WRITE_TOOLS.extend([delete_contact, send_mail, archive_mail, move_mail, invite_attendees])
CONFIRMED_WRITE_TOOLS.extend(
    [
        delete_table,
        restore_page_version,
        empty_trash,
        change_schema,
        bulk_update_rows,
        replace_reference_ids_in_titles,
    ]
)

_PATCHABLE_SEAMS = frozenset(
    {
        "_assert_global_integration_access",
        "_confirmation",
        "_mail_message_preview",
        "_mail_message_snapshot",
        "_page_files",
        "_parse",
        "_resolve_page",
        "_table",
        "_table_delete_snapshot",
        "_table_rows_snapshot",
        "_write_page",
    }
)
_IMPLEMENTATION_MODULES = (
    support,
    mutation,
    vault_tools,
    integrations,
    confirmations,
    dispatch,
    dispatch_basic,
    dispatch_rows,
    dispatch_tables,
)


class _CompatibilityModule(types.ModuleType):
    """Propagate documented monkeypatch seams to canonical module globals."""

    def __setattr__(self, name: str, value: Any) -> None:
        super().__setattr__(name, value)
        if name not in _PATCHABLE_SEAMS:
            return
        for implementation in _IMPLEMENTATION_MODULES:
            if hasattr(implementation, name):
                setattr(implementation, name, value)


sys.modules[__name__].__class__ = _CompatibilityModule
