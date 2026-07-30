"""Safety and catalog tests for first-party Gnosi agent tools."""
import asyncio
import json

import pytest

from backend.agent import gnosi_tools
from backend.agent.action_confirmations import confirmation_context
from backend.agent.gnosi_tools import (
    CONFIRMED_WRITE_TOOLS,
    EXPLICIT_WRITE_TOOLS,
    READ_TOOLS,
    _bounded_limit,
    get_table_row,
    list_table_rows,
)
from backend.services.context_vars import active_vault_path


def _names(tools):
    return {tool.name for tool in tools}


def test_catalog_has_unique_names_and_expected_risk_classes():
    reads = _names(READ_TOOLS)
    writes = _names(EXPLICIT_WRITE_TOOLS)
    confirmed = _names(CONFIRMED_WRITE_TOOLS)

    assert not (reads & writes)
    assert not (reads & confirmed)
    assert not (writes & confirmed)
    assert {
        "list_table_rows",
        "get_table_row",
        "list_tags",
        "find_pages_by_tag",
        "get_page_links",
        "get_page_history",
        "list_calendar_events",
        "search_mail",
        "list_contacts",
    } <= reads
    assert {
        "create_table_row",
        "update_page",
        "append_to_page",
        "update_table_row",
        "add_tags",
        "add_page_comment",
        "mark_task_complete",
        "create_contact",
    } <= writes
    assert {
        "delete_page",
        "create_calendar_event",
        "save_mail_draft",
        "delete_contact",
        "send_mail",
        "archive_mail",
        "move_mail",
        "invite_attendees",
        "delete_table",
        "restore_page_version",
        "empty_trash",
        "change_schema",
        "bulk_update_rows",
    } <= confirmed


def test_tool_result_limits_are_bounded():
    assert _bounded_limit(0) == 20
    assert _bounded_limit(-3) == 1
    assert _bounded_limit(10_000) == 100


def test_read_tools_operate_on_the_active_vault(tmp_path, monkeypatch):
    page = tmp_path / "Projects" / "Alpha.md"
    page.parent.mkdir()
    page.write_text(
        "---\n"
        "id: row-1\n"
        "title: Alpha\n"
        "table_id: projects\n"
        "database_table_id: projects\n"
        "tags: [active, client]\n"
        "---\n\nProject body.\n",
        encoding="utf-8",
    )
    token = active_vault_path.set(tmp_path)
    monkeypatch.setattr(
        gnosi_tools,
        "_table",
        lambda identifier: {"id": "projects", "name": "Projects"}
        if identifier == "projects"
        else None,
    )
    try:
        rows = json.loads(list_table_rows.invoke({"table_id_or_name": "projects"}))
        tags = json.loads(gnosi_tools.list_tags.invoke({}))
        row = json.loads(get_table_row.invoke({"row_id_or_title": "row-1"}))
    finally:
        active_vault_path.reset(token)

    assert rows["rows"][0]["id"] == "row-1"
    assert {item["tag"] for item in tags} == {"active", "client"}
    assert row["content"].strip() == "Project body."


def test_installation_global_integrations_are_personal_workspace_only():
    with confirmation_context(
        vault_scope="vault",
        workspace_id="workspace-a",
        user_id="user",
        role="editor",
        agent_id="agent",
        session_id="session",
    ):
        with pytest.raises(PermissionError):
            gnosi_tools._assert_global_integration_access(
                "person@example.com"
            )


def test_stale_page_revision_blocks_confirmed_delete(tmp_path, monkeypatch):
    page = tmp_path / "Page.md"
    page.write_text("original", encoding="utf-8")
    initial_revision = gnosi_tools._file_revision(page)
    monkeypatch.setattr(gnosi_tools, "_resolve_page", lambda _identifier: page)
    page.write_text("changed", encoding="utf-8")

    with pytest.raises(gnosi_tools.ActionConflictError):
        asyncio.run(gnosi_tools.execute_confirmed_action(
            "delete_page",
            {
                "page_id": "page-1",
                "page_revision": initial_revision,
            },
            workspace_id="personal",
        ))

    assert page.read_text(encoding="utf-8") == "changed"


def test_bulk_update_rolls_back_every_written_row(tmp_path, monkeypatch):
    first = tmp_path / "First.md"
    second = tmp_path / "Second.md"
    first.write_text("first-original", encoding="utf-8")
    second.write_text("second-original", encoding="utf-8")
    paths = {"row-1": first, "row-2": second}

    monkeypatch.setattr(
        gnosi_tools,
        "_resolve_page",
        lambda identifier: paths.get(identifier),
    )
    monkeypatch.setattr(
        gnosi_tools,
        "_parse",
        lambda path: (
            {
                "id": "row-1" if path == first else "row-2",
                "table_id": "table-1",
            },
            "body",
        ),
    )
    calls = []

    def write_page(path, _metadata, _body):
        calls.append(path)
        if path == second:
            raise OSError("simulated second-row failure")
        path.write_text("first-changed", encoding="utf-8")

    monkeypatch.setattr(gnosi_tools, "_write_page", write_page)
    from backend.api import vault_routes

    monkeypatch.setattr(
        vault_routes,
        "register_page_in_index",
        lambda _path: None,
    )
    with pytest.raises(RuntimeError, match="rolled back"):
        asyncio.run(gnosi_tools.execute_confirmed_action(
            "bulk_update_rows",
            {
                "updates": [
                    {
                        "id": "row-1",
                        "properties": {"status": "done"},
                        "revision": gnosi_tools._file_revision(first),
                    },
                    {
                        "id": "row-2",
                        "properties": {"status": "done"},
                        "revision": gnosi_tools._file_revision(second),
                    },
                ]
            },
            workspace_id="personal",
        ))

    assert calls == [first, second]
    assert first.read_text(encoding="utf-8") == "first-original"
    assert second.read_text(encoding="utf-8") == "second-original"


def test_empty_trash_purges_only_the_confirmed_snapshot(tmp_path, monkeypatch):
    trash = tmp_path / ".trash"
    old_entry = trash / "old-entry"
    old_entry.mkdir(parents=True)
    (old_entry / "_trash.json").write_text(
        '{"title":"Old page"}',
        encoding="utf-8",
    )
    token = active_vault_path.set(tmp_path)
    try:
        expected = gnosi_tools._trash_snapshot()
        new_entry = trash / "new-entry"
        new_entry.mkdir()
        (new_entry / "_trash.json").write_text(
            '{"title":"New page"}',
            encoding="utf-8",
        )
        from backend.api import vault_routes

        purged = []

        def purge(entry_id):
            purged.append(entry_id)
            return {"freed_bytes": 12}

        monkeypatch.setattr(vault_routes, "_purge_trash_entry", purge)
        result = asyncio.run(gnosi_tools.execute_confirmed_action(
            "empty_trash",
            {
                "entries": expected,
                "snapshot_digest": gnosi_tools._value_revision(expected),
            },
            workspace_id="personal",
        ))
    finally:
        active_vault_path.reset(token)

    assert result["status"] == "completed"
    assert purged == ["old-entry"]
    assert new_entry.exists()


def test_restore_version_rejects_path_like_timestamps(tmp_path, monkeypatch):
    page = tmp_path / "Page.md"
    page.write_text("current", encoding="utf-8")
    monkeypatch.setattr(gnosi_tools, "_resolve_page", lambda _identifier: page)
    monkeypatch.setattr(
        gnosi_tools,
        "_parse",
        lambda _path: ({"id": "page-1", "title": "Page"}, "current"),
    )
    token = active_vault_path.set(tmp_path)
    try:
        with pytest.raises(Exception):
            gnosi_tools.restore_page_version.invoke({
                "page_id_or_title": "page-1",
                "timestamp": "../../outside",
            })
    finally:
        active_vault_path.reset(token)


def test_changed_calendar_event_blocks_invitation(monkeypatch):
    from backend.services import hybrid_calendar_service

    monkeypatch.setattr(
        gnosi_tools,
        "_assert_global_integration_access",
        lambda account, **_kwargs: account,
    )
    original = {
        "id": "event-1",
        "title": "Original title",
        "start": "2026-08-01T10:00:00+02:00",
        "end": "2026-08-01T11:00:00+02:00",
        "calendar_id": "primary",
        "attendees": [],
    }
    changed = {**original, "title": "Changed title"}
    monkeypatch.setattr(
        hybrid_calendar_service,
        "get_event",
        lambda *_args, **_kwargs: changed,
    )

    with pytest.raises(gnosi_tools.ActionConflictError):
        asyncio.run(gnosi_tools.execute_confirmed_action(
            "invite_attendees",
            {
                "account": "person@example.com",
                "event_id": "event-1",
                "attendees": ["guest@example.com"],
                "calendar_id": "primary",
                "event_revision": gnosi_tools._value_revision(original),
            },
            workspace_id="personal",
        ))
