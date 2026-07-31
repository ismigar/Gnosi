"""Safety and catalog tests for first-party Gnosi agent tools."""
import asyncio
import json

import pytest
from fastapi import BackgroundTasks, HTTPException

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


def test_nested_page_metadata_is_recursively_bounded():
    value = {"nested": [{"secret": "x" * 10_000} for _ in range(150)]}

    bounded = gnosi_tools._bounded_json_value(value)

    assert len(bounded["nested"]) == 100
    assert len(bounded["nested"][0]["secret"]) == 2_000


def test_page_mutation_rejects_external_revision_change(tmp_path):
    page = tmp_path / "page.md"
    page.write_text("---\nid: page-1\ntitle: Page\n---\n\nOriginal\n", encoding="utf-8")

    def conflicting_mutation(metadata, body):
        page.write_text("---\nid: page-1\ntitle: Page\n---\n\nExternal\n", encoding="utf-8")
        return metadata, f"{body}\nAgent"

    with pytest.raises(gnosi_tools.ActionConflictError):
        gnosi_tools._mutate_page(page, conflicting_mutation)

    assert "External" in page.read_text(encoding="utf-8")


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
            path.write_text("second-changed", encoding="utf-8")
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


def test_empty_trash_rejects_changed_content_inside_existing_entry(
    tmp_path,
    monkeypatch,
):
    entry = tmp_path / ".trash" / "entry"
    entry.mkdir(parents=True)
    (entry / "_trash.json").write_text('{"title":"Page"}', encoding="utf-8")
    page = entry / "page.md"
    page.write_text("original", encoding="utf-8")
    token = active_vault_path.set(tmp_path)
    try:
        expected = gnosi_tools._trash_snapshot()
        page.write_text("changed after preview", encoding="utf-8")
        from backend.api import vault_routes

        purged = []
        monkeypatch.setattr(
            vault_routes,
            "_purge_trash_entry",
            lambda entry_id: purged.append(entry_id),
        )
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

    assert result["status"] == "partial"
    assert result["failed_ids"] == ["entry"]
    assert purged == []
    assert page.exists()


def test_mail_preview_is_account_bound_and_revision_checked(tmp_path, monkeypatch):
    mail = tmp_path / "Mail"
    mail.mkdir()
    first = mail / "message-1_First.md"
    first.write_text(
        "---\nid: message-1\ntitle: First\naccount: first@example.com\n---\n",
        encoding="utf-8",
    )
    second = mail / "message-1_Second.md"
    second.write_text(
        "---\nid: message-1\ntitle: Second\naccount: second@example.com\n---\n",
        encoding="utf-8",
    )
    from backend.api import mail_routes

    monkeypatch.setattr(mail_routes, "get_mail_vault_path", lambda: mail)
    snapshot = gnosi_tools._mail_message_preview(
        "second@example.com",
        "message-1",
    )

    assert snapshot["subject"] == "Second"
    second.write_text(second.read_text(encoding="utf-8") + "changed", encoding="utf-8")
    with pytest.raises(gnosi_tools.ActionConflictError):
        asyncio.run(gnosi_tools._require_mail_message_revision(
            "second@example.com",
            "message-1",
            snapshot["message_revision"],
            expected_source="vault",
        ))


def test_remote_mail_snapshot_is_account_bound_and_content_sealed(monkeypatch):
    from backend.api import mail_routes

    monkeypatch.setattr(
        gnosi_tools,
        "_mail_message_preview",
        lambda _account, _message_id: None,
    )

    async def remote_message(message_id, email=None, folder=None):
        return {
            "id": message_id,
            "thread_id": "thread-1",
            "subject": "Subject",
            "sender": "sender@example.com",
            "recipient": "person@example.com",
            "date": "2026-07-30",
            "body_text": "Exact body",
            "account": email,
            "source": "imap",
            "imap_uid": "42",
            "imap_folder": folder,
        }

    monkeypatch.setattr(mail_routes, "get_message", remote_message)
    snapshot = asyncio.run(gnosi_tools._mail_message_snapshot(
        "person@example.com",
        "imap_42",
        "INBOX",
    ))

    assert snapshot["message_source"] == "provider"
    assert snapshot["imap_uid"] == "42"
    assert snapshot["imap_folder"] == "INBOX"

    async def changed_remote_message(message_id, email=None, folder=None):
        message = await remote_message(message_id, email, folder)
        message["body_text"] = "Changed body"
        return message

    monkeypatch.setattr(mail_routes, "get_message", changed_remote_message)
    with pytest.raises(gnosi_tools.ActionConflictError):
        asyncio.run(gnosi_tools._require_mail_message_revision(
            "person@example.com",
            "imap_42",
            snapshot["message_revision"],
            expected_source="provider",
            folder="INBOX",
        ))


def test_move_mail_uses_the_same_exact_snapshot_for_arguments_and_preview(
    monkeypatch,
):
    snapshot = {
        "message_id": "message-1",
        "subject": "Subject",
        "sender": "sender@example.com",
        "date": "2026-07-30",
        "imap_uid": "",
        "imap_folder": "",
        "message_revision": "abc123",
        "message_source": "provider",
    }
    monkeypatch.setattr(
        gnosi_tools,
        "_assert_global_integration_access",
        lambda account, **_kwargs: account,
    )
    monkeypatch.setattr(
        gnosi_tools,
        "_mail_message_snapshot",
        lambda _account, _message_id, _folder="": asyncio.sleep(
            0,
            result=snapshot,
        ),
    )
    captured = {}

    def capture(action, arguments, details, **_kwargs):
        captured.update({
            "action": action,
            "arguments": arguments,
            "details": details,
        })
        return "{}"

    monkeypatch.setattr(gnosi_tools, "_confirmation", capture)
    asyncio.run(gnosi_tools.move_mail.ainvoke({
        "account": "person@example.com",
        "message_id": "message-1",
        "target_folder": "Archive",
    }))

    assert captured["arguments"] == {
        "account": "person@example.com",
        "message_id": "message-1",
        "target_folder": "Archive",
        "folder": "",
        "imap_uid": "",
        "imap_folder": "",
        "message_revision": "abc123",
        "message_source": "provider",
    }
    assert captured["details"]["subject"] == "Subject"
    assert captured["details"]["message_revision"] == "abc123"


def test_delete_table_requires_row_disposition_and_seals_asset_snapshot(
    tmp_path,
    monkeypatch,
):
    table = {
        "id": "table-1",
        "name": "Projects",
        "database_id": "db-1",
    }
    database = {"id": "db-1", "name": "Work"}
    registry_holder = {
        "value": {
            "tables": [table],
            "databases": [database],
            "views": [{"id": "view-1", "table_id": "table-1"}],
        }
    }
    assets = tmp_path / "Assets"
    structured = assets / "Work" / "Projects"
    structured.mkdir(parents=True)
    asset = structured / "file.txt"
    asset.write_text("original", encoding="utf-8")
    from backend.api import vault_routes

    monkeypatch.setattr(
        vault_routes,
        "get_p",
        lambda key: {
            "VAULT": tmp_path,
            "ASSETS": assets,
        }[key],
    )
    monkeypatch.setattr(
        vault_routes,
        "load_registry",
        lambda: json.loads(json.dumps(registry_holder["value"])),
    )
    monkeypatch.setattr(
        vault_routes,
        "save_registry",
        lambda value: registry_holder.update({
            "value": json.loads(json.dumps(value))
        }),
    )
    monkeypatch.setattr(gnosi_tools, "_table", lambda _identifier: table)
    monkeypatch.setattr(
        gnosi_tools,
        "_table_delete_snapshot",
        lambda _table: {
            "table_revision": "table-rev",
            "views_revision": "views-rev",
            "rows_revision": "rows-rev",
            "asset_revision": "asset-rev",
            "row_count": 2,
            "views_count": 1,
        },
    )

    missing_choice = json.loads(gnosi_tools.delete_table.invoke({
        "table_id_or_name": "table-1",
    }))
    assert "Choose row_action" in missing_choice["error"]

    expected_table_revision = vault_routes._stable_value_revision(table)
    expected_views_revision = vault_routes._table_views_revision(
        registry_holder["value"],
        "table-1",
    )
    expected_asset_revision = vault_routes._table_asset_revision(table, database)
    asset.write_text("changed after preview", encoding="utf-8")
    with pytest.raises(HTTPException) as conflict:
        asyncio.run(vault_routes.delete_table(
            "table-1",
            BackgroundTasks(),
            expected_table_revision=expected_table_revision,
            expected_views_revision=expected_views_revision,
            expected_asset_revision=expected_asset_revision,
        ))
    assert conflict.value.status_code == 409
    assert asset.exists()
    assert registry_holder["value"]["tables"]

    current_asset_revision = vault_routes._table_asset_revision(table, database)
    result = asyncio.run(vault_routes.delete_table(
        "table-1",
        BackgroundTasks(),
        expected_table_revision=expected_table_revision,
        expected_views_revision=expected_views_revision,
        expected_asset_revision=current_asset_revision,
    ))
    assert result["cleanup_status"] == "queued"
    assert not structured.exists()
    assert registry_holder["value"]["tables"] == []
    assert vault_routes.cleanup_pending_table_asset_quarantines(tmp_path) == 1


def test_table_asset_quarantine_preserves_sibling_trees_on_name_collision(
    tmp_path,
    monkeypatch,
):
    table = {
        "id": "table-1",
        "name": "Work",
        "database_id": "db-1",
    }
    database = {"id": "db-1", "name": "Work"}
    registry_holder = {
        "value": {
            "tables": [table],
            "databases": [database],
            "views": [],
        }
    }
    assets = tmp_path / "Assets"
    own_structured = assets / "Work" / "Work"
    sibling_structured = assets / "Work" / "Other"
    own_structured.mkdir(parents=True)
    sibling_structured.mkdir(parents=True)
    (own_structured / "own.txt").write_text("own", encoding="utf-8")
    sibling_asset = sibling_structured / "sibling.txt"
    sibling_asset.write_text("sibling", encoding="utf-8")
    loose_asset = assets / "Work" / "loose.txt"
    loose_asset.write_text("loose", encoding="utf-8")
    from backend.api import vault_routes

    monkeypatch.setattr(
        vault_routes,
        "get_p",
        lambda key: {
            "VAULT": tmp_path,
            "ASSETS": assets,
        }[key],
    )
    monkeypatch.setattr(
        vault_routes,
        "load_registry",
        lambda: json.loads(json.dumps(registry_holder["value"])),
    )
    monkeypatch.setattr(
        vault_routes,
        "save_registry",
        lambda value: registry_holder.update({
            "value": json.loads(json.dumps(value))
        }),
    )
    expected_asset_revision = vault_routes._table_asset_revision(table, database)

    result = asyncio.run(vault_routes.delete_table(
        "table-1",
        BackgroundTasks(),
        expected_table_revision=vault_routes._stable_value_revision(table),
        expected_views_revision=vault_routes._table_views_revision(
            registry_holder["value"],
            "table-1",
        ),
        expected_asset_revision=expected_asset_revision,
    ))

    assert result["cleanup_status"] == "queued"
    assert not own_structured.exists()
    assert not loose_asset.exists()
    assert sibling_asset.read_text(encoding="utf-8") == "sibling"
    assert vault_routes.cleanup_pending_table_asset_quarantines(tmp_path) == 1


def test_uncommitted_table_asset_quarantine_is_restored_after_restart(
    tmp_path,
    monkeypatch,
):
    table = {
        "id": "table-1",
        "name": "Projects",
        "database_id": "db-1",
    }
    database = {"id": "db-1", "name": "Work"}
    assets = tmp_path / "Assets"
    asset = assets / "Work" / "Projects" / "file.txt"
    asset.parent.mkdir(parents=True)
    asset.write_text("content", encoding="utf-8")
    registry_path = tmp_path / "BD" / "vault_db_registry.json"
    registry_path.parent.mkdir()
    registry_path.write_text(
        json.dumps({
            "tables": [table],
            "databases": [database],
            "views": [],
        }),
        encoding="utf-8",
    )
    from backend.api import vault_routes

    monkeypatch.setattr(
        vault_routes,
        "get_p",
        lambda key: {
            "VAULT": tmp_path,
            "ASSETS": assets,
            "REGISTRY": registry_path,
        }[key],
    )
    quarantine, moved = vault_routes._quarantine_table_asset_dirs(
        table,
        database,
    )

    assert moved
    assert not asset.exists()
    assert vault_routes.cleanup_pending_table_asset_quarantines(tmp_path) == 1
    assert asset.read_text(encoding="utf-8") == "content"
    assert not quarantine.exists()


def test_uncommitted_quarantine_is_untouched_when_registry_is_unreadable(
    tmp_path,
    monkeypatch,
):
    table = {
        "id": "table-1",
        "name": "Projects",
        "database_id": "db-1",
    }
    database = {"id": "db-1", "name": "Work"}
    assets = tmp_path / "Assets"
    asset = assets / "Work" / "Projects" / "file.txt"
    asset.parent.mkdir(parents=True)
    asset.write_text("content", encoding="utf-8")
    from backend.api import vault_routes

    monkeypatch.setattr(
        vault_routes,
        "get_p",
        lambda key: {
            "VAULT": tmp_path,
            "ASSETS": assets,
            "REGISTRY": tmp_path / "BD" / "missing.json",
        }[key],
    )
    quarantine, moved = vault_routes._quarantine_table_asset_dirs(
        table,
        database,
    )

    assert moved
    assert vault_routes.cleanup_pending_table_asset_quarantines(tmp_path) == 0
    assert quarantine.exists()
    assert not asset.exists()


def test_table_asset_quarantine_moves_symlink_without_following_target(
    tmp_path,
    monkeypatch,
):
    table = {
        "id": "table-1",
        "name": "Projects",
        "database_id": "db-1",
    }
    database = {"id": "db-1", "name": "Work"}
    assets = tmp_path / "Assets"
    asset_link = assets / "Work" / "Projects"
    asset_link.parent.mkdir(parents=True)
    external_target = tmp_path / "external-assets"
    external_target.mkdir()
    external_file = external_target / "keep.txt"
    external_file.write_text("keep", encoding="utf-8")
    asset_link.symlink_to(external_target, target_is_directory=True)
    from backend.api import vault_routes

    monkeypatch.setattr(
        vault_routes,
        "get_p",
        lambda key: {
            "VAULT": tmp_path,
            "ASSETS": assets,
        }[key],
    )

    quarantine, moved = vault_routes._quarantine_table_asset_dirs(
        table,
        database,
    )

    assert moved
    assert not asset_link.exists()
    assert moved[0][1].is_symlink()
    assert external_file.read_text(encoding="utf-8") == "keep"
    vault_routes._restore_quarantined_table_assets(quarantine, moved)
    assert asset_link.is_symlink()
    assert external_file.read_text(encoding="utf-8") == "keep"


def test_cleanup_leaves_unknown_or_ambiguous_quarantine_entries_untouched(
    tmp_path,
):
    from backend.api import vault_routes

    cleanup_root = vault_routes._table_asset_cleanup_root(tmp_path)
    unknown = cleanup_root / "manual-backup"
    unknown.mkdir(parents=True)
    (unknown / "keep.txt").write_text("keep", encoding="utf-8")
    ambiguous = cleanup_root / "in-progress-ambiguous"
    ambiguous.mkdir()
    (ambiguous / "_manifest.json").write_text(
        json.dumps({"table_id": "", "entries": []}),
        encoding="utf-8",
    )

    assert vault_routes.cleanup_pending_table_asset_quarantines(tmp_path) == 0
    assert (unknown / "keep.txt").read_text(encoding="utf-8") == "keep"
    assert ambiguous.exists()


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
