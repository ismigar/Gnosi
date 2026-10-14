"""View titles and exposed filters round-trip through the existing flexible API."""
import asyncio

from backend.api import vault_routes as vr
from backend.api.vault_views_routes import ViewSection
from backend.domains.vault.views.contracts import VaultViewInput, VaultViewResponse


def test_saved_view_keeps_catalog_name_and_presentation_configuration(monkeypatch):
    registry = {"tables": [{"id": "tasks", "name": "Tasks"}], "views": []}
    monkeypatch.setattr(vr, "load_registry", lambda: registry)
    monkeypatch.setattr(vr, "save_registry", lambda _registry: None)
    rule = {"field": "done", "operator": "equals", "value": False, "exposed": True}
    payload = VaultViewInput.model_validate({
        "id": "board", "table_id": "tasks", "name": "Tasks per project - Kanban",
        "displayTitle": "Kanban", "type": "board", "filters": [rule],
        "filterTree": {"conjunction": "and", "rules": [rule]},
    }).model_dump(exclude_unset=True)
    created = asyncio.run(vr.create_view(payload))
    restored = VaultViewResponse.model_validate(created).model_dump(exclude_unset=True)
    assert restored["name"] == "Tasks per project - Kanban"
    assert restored["displayTitle"] == "Kanban"
    assert restored["filterTree"]["rules"] == [rule]
    asyncio.run(vr.update_view("board", {"displayTitle": ""}))
    assert registry["views"][0]["name"] == "Tasks per project - Kanban"
    assert registry["views"][0]["displayTitle"] == ""
    assert registry["views"][0]["filters"] == [rule]


def test_inline_section_preserves_title_and_exposed_period_filter():
    rule = {"field": "period", "operator": "equals", "value": "today", "periodPart": "end", "exposed": True}
    section = ViewSection.model_validate({
        "heading": "Project tasks", "source_table_id": "tasks", "displayTitle": "Kanban",
        "filterTree": {"conjunction": "or", "rules": [rule]},
    })
    restored = ViewSection.model_validate_json(section.model_dump_json()).model_dump()
    assert restored["displayTitle"] == "Kanban"
    assert restored["heading"] == "Project tasks"
    assert restored["filterTree"]["rules"] == [rule]
