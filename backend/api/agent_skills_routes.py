"""Compatibility facade for governed agent configuration APIs."""

from __future__ import annotations

import sys
from types import ModuleType
from typing import Any

from backend.domains.configuration.agent.catalog_routes import (
    _entry_response,
    _refresh_mcp_catalog,
    _validate_automation_target,
    _validate_referenced_tools,
    assign_agent_skills,
    clone_skill,
    configure_catalog_dependencies,
    create_skill,
    create_skill_automation,
    delete_skill,
    get_agent_skills,
    get_skill,
    get_skill_automation,
    list_skill_automation_runs,
    list_skill_automations,
    list_skills,
    list_tools,
    remove_skill_automation,
    run_skill_automation_now,
    update_skill,
    update_skill_automation,
    validate_skill,
)
from backend.domains.configuration.agent.contracts import (
    AgentSkillAssignmentPayload,
    AutomationWritePayload,
    CloneSkillPayload,
    EvaluationCandidateReviewPayload,
    PersonalMemoryPayload,
    SemanticAssociationPayload,
    UserSkillWritePayload,
)
from backend.domains.configuration.agent.governance_routes import (
    _assignment_store,
    _automation_scope,
    _metadata,
    _require_configured_agent,
    _store_for,
    cancel_governed_job,
    configure_job_dependencies,
    create_agent_memory,
    create_agent_semantic_association,
    edit_agent_memory,
    get_agent_capability_conformance,
    get_agent_memories,
    get_agent_quality_dashboard,
    get_agent_semantic_associations,
    get_governed_job,
    get_governed_job_result,
    get_model_evaluations,
    list_agent_evaluation_candidates,
    list_governed_jobs,
    list_workspace_approvals,
    list_workspace_capability_audit,
    remove_agent_memory,
    remove_agent_semantic_association,
    resume_governed_job,
    review_agent_evaluation_candidate,
    run_agent_model_evaluation,
    run_reviewed_agent_evaluation_candidates,
)
from backend.domains.configuration.agent.router import router
from backend.services.agent_quality_telemetry import (
    list_evaluation_candidates,
    review_evaluation_candidate,
    reviewed_evaluation_cases,
)
from backend.services.agent_skill_catalog import get_skill_catalog, get_tool_catalog
from backend.services.capability_jobs import (
    cancel_job as cancel_capability_job,
)
from backend.services.capability_jobs import (
    get_job_status as get_capability_job_status,
)
from backend.services.capability_jobs import (
    read_job_result as read_capability_job_result,
)
from backend.services.capability_jobs import (
    resume_job as resume_capability_job,
)

configure_job_dependencies(
    get_status=lambda vault, job: get_capability_job_status(vault, job),
    read_result=lambda vault, job: read_capability_job_result(vault, job),
    cancel=lambda vault, job: cancel_capability_job(vault, job),
    resume=lambda vault, job: resume_capability_job(vault, job),
    skill_catalog=lambda: get_skill_catalog(),
    tool_catalog=lambda: get_tool_catalog(),
)
configure_catalog_dependencies(
    skill_catalog=lambda: get_skill_catalog(),
    tool_catalog=lambda: get_tool_catalog(),
    assignment_store=lambda: _assignment_store(),
)


class _CompatibilityModule(ModuleType):
    """Propagate historical quality-telemetry monkeypatch seams."""

    def __setattr__(self, name: str, value: Any) -> None:
        super().__setattr__(name, value)
        if name in {
            "list_evaluation_candidates",
            "review_evaluation_candidate",
            "reviewed_evaluation_cases",
        }:
            from backend.domains.configuration.agent import governance_routes

            setattr(governance_routes, name, value)


sys.modules[__name__].__class__ = _CompatibilityModule

__all__ = [
    "AgentSkillAssignmentPayload",
    "AutomationWritePayload",
    "CloneSkillPayload",
    "EvaluationCandidateReviewPayload",
    "PersonalMemoryPayload",
    "SemanticAssociationPayload",
    "UserSkillWritePayload",
    "_assignment_store",
    "_automation_scope",
    "_entry_response",
    "_metadata",
    "_refresh_mcp_catalog",
    "_require_configured_agent",
    "_store_for",
    "_validate_automation_target",
    "_validate_referenced_tools",
    "assign_agent_skills",
    "cancel_capability_job",
    "cancel_governed_job",
    "clone_skill",
    "create_agent_memory",
    "create_agent_semantic_association",
    "create_skill",
    "create_skill_automation",
    "delete_skill",
    "edit_agent_memory",
    "get_agent_capability_conformance",
    "get_agent_memories",
    "get_agent_quality_dashboard",
    "get_agent_semantic_associations",
    "get_agent_skills",
    "get_capability_job_status",
    "get_governed_job",
    "get_governed_job_result",
    "get_model_evaluations",
    "get_skill",
    "get_skill_automation",
    "get_skill_catalog",
    "get_tool_catalog",
    "list_agent_evaluation_candidates",
    "list_evaluation_candidates",
    "list_governed_jobs",
    "list_skill_automation_runs",
    "list_skill_automations",
    "list_skills",
    "list_tools",
    "list_workspace_approvals",
    "list_workspace_capability_audit",
    "read_capability_job_result",
    "remove_agent_memory",
    "remove_agent_semantic_association",
    "remove_skill_automation",
    "resume_capability_job",
    "resume_governed_job",
    "review_agent_evaluation_candidate",
    "review_evaluation_candidate",
    "reviewed_evaluation_cases",
    "router",
    "run_agent_model_evaluation",
    "run_reviewed_agent_evaluation_candidates",
    "run_skill_automation_now",
    "update_skill",
    "update_skill_automation",
    "validate_skill",
]
