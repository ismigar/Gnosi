"""Upsert page sections by view_id (not by heading).

Ensures that multiple embeds WITHOUT a heading don't collide.
"""
from backend.api.vault_views_routes import _find_section_upsert_index


def test_distinct_view_ids_same_empty_heading_no_collision():
    sections = [{"view_id": "v1", "heading": ""}]
    # new embed: same empty heading, but different view_id → add (None)
    assert _find_section_upsert_index(sections, "v2", "") is None


def test_same_view_id_updates_in_place():
    sections = [{"view_id": "v1", "heading": "A"}, {"view_id": "v2", "heading": ""}]
    assert _find_section_upsert_index(sections, "v2", "") == 1


def test_view_id_not_present_appends():
    assert _find_section_upsert_index([], "v1", "") is None


def test_inline_section_matches_by_heading():
    sections = [{"heading": "Notes"}, {"view_id": "v1", "heading": ""}]
    assert _find_section_upsert_index(sections, None, "Notes") == 0


def test_inline_does_not_overwrite_view_backed_section():
    # an inline section (without view_id) with an empty heading must NOT overwrite a
    # section anchored to a registry view (which has view_id)
    sections = [{"view_id": "v1", "heading": ""}]
    assert _find_section_upsert_index(sections, None, "") is None
