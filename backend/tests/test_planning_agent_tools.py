"""Governed Planning tools reuse authoritative Planning APIs."""
import asyncio
import json

from backend.agent.planning_tools import (
    planning_get_project_schedule,
    planning_materialize_recurrence,
)
from backend.models.agent_skills import ConfirmationPolicy, ToolEffect
from backend.services.gnosi_ai_contributions import (
    core_gnosi_registrations,
    core_gnosi_skill_descriptors,
)


def test_planning_read_tool_uses_exact_project(monkeypatch):
    from backend.api import planning_routes

    async def fake_schedule(project_id):
        return {"projectId": project_id, "scheduleRevision": 7}

    monkeypatch.setattr(planning_routes, "get_project_schedule", fake_schedule)
    result = json.loads(asyncio.run(
        planning_get_project_schedule.ainvoke({"project_id": "p1"})
    ))
    assert result == {"projectId": "p1", "scheduleRevision": 7}


def test_planning_bulk_tool_clamps_materialization(monkeypatch):
    from backend.api import planning_routes

    async def fake_materialize(recurrence_id, limit):
        return {"recurrence_id": recurrence_id, "limit": limit}

    monkeypatch.setattr(planning_routes, "materialize_recurrence", fake_materialize)
    result = json.loads(asyncio.run(
        planning_materialize_recurrence.ainvoke({
            "recurrence_id": "repeat-1",
            "limit": 500,
        })
    ))
    assert result == {"recurrence_id": "repeat-1", "limit": 50}


def test_planning_catalog_separates_reads_and_bulk_writes():
    descriptors = {
        descriptor.id: descriptor
        for descriptor, _handler in core_gnosi_registrations()
        if descriptor.metadata.get("domain") == "planning"
    }
    assert descriptors["core.gnosi.planning-get-state"].effects == [ToolEffect.READ]
    apply = descriptors["core.gnosi.planning-apply-leveling-proposal"]
    assert apply.effects == [ToolEffect.LOCAL_WRITE, ToolEffect.BULK_WRITE]
    assert apply.confirmation == ConfirmationPolicy.EXPLICIT_REQUEST


def test_cross_domain_workflows_are_composed_from_available_tools():
    registrations = core_gnosi_registrations()
    skills = {
        descriptor.id: descriptor
        for descriptor in core_gnosi_skill_descriptors(registrations)
    }

    briefing = skills["core.gnosi-daily-briefing"]
    assert briefing.activation.value == "automatic"
    assert briefing.metadata["required_source_ids"] == [
        "calendar", "mail", "reader", "planning"
    ]
    topic = skills["core.gnosi-reader-topic-evolution"]
    assert topic.activation.value == "explicit"
    assert "core.gnosi.estimate-capability-job" in topic.tool_ids
    assert "core.gnosi.start-reader-topic-analysis" in topic.tool_ids
