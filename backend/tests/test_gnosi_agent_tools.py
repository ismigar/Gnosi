"""Safety and catalog tests for first-party Gnosi agent tools."""
import json

from backend.agent import gnosi_tools
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
        "create_calendar_event",
        "create_contact",
        "save_mail_draft",
    } <= writes
    assert {
        "delete_page",
        "delete_contact",
        "send_mail",
        "archive_mail",
        "move_mail",
        "invite_attendees",
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
