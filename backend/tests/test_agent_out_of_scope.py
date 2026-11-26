"""Tests for explicit agent profile out-of-scope rejection contracts."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from backend.domains.agent.workflow_setup import ModelSetup, ProfileSetup, build_prompts
from backend.services.agent_execution import snapshot_from_runtime
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_gauntlet import _fresh_snapshot


def _profile_setup(agent_data: dict[str, Any]) -> ProfileSetup:
    runtime = SimpleNamespace(active_skill_ids=(), assigned_skill_ids=(), instructions=(), skills=(), catalog_revision="rev1")
    return ProfileSetup(
        ai_cfg={},
        providers={},
        connector_health=[],
        target_id=str(agent_data.get("id", "specialist")),
        agent_data=agent_data,
        resolved_runtime=runtime,
    )


def _model_setup() -> ModelSetup:
    return ModelSetup(
        llm=SimpleNamespace(),  # type: ignore[arg-type]
        provider_name="openai",
        model_name="gpt-4o-mini",
        strategy={"mode": "pinned"},
        fallback_metadata=[],
    )


def test_build_prompts_injects_out_of_scope_block_and_bounds_it(tmp_path: Path) -> None:
    agent_data = {
        "id": "writer",
        "persona": "Draft concise project summaries.",
        "out_of_scope": "Never send emails or modify billing tables.",
        "_execution_detailed_persona": "",
    }
    prompt_setup = build_prompts(
        _profile_setup(agent_data),
        _model_setup(),
        active_skill_ids=None,
        vault_path=tmp_path,
        memory_user_id="user-1",
        reviewed_memory_rows=[],
        user_message="Summarize this note.",
        instructions_dir=tmp_path,
        default_vault_path=tmp_path,
        max_skill_instruction_chars=4_000,
        max_system_prompt_chars=16_000,
        default_supervisor_prompt="Coordinate.",
        preserve_instructions=False,
    )
    assert "Out of scope (refuse or defer requests outside these boundaries):" in prompt_setup.combined_persona
    assert "Never send emails or modify billing tables." in prompt_setup.combined_persona

    oversized = {**agent_data, "out_of_scope": "x" * 5_000}
    bounded = build_prompts(
        _profile_setup(oversized),
        _model_setup(),
        active_skill_ids=None,
        vault_path=tmp_path,
        memory_user_id="user-1",
        reviewed_memory_rows=[],
        user_message="Summarize this note.",
        instructions_dir=tmp_path,
        default_vault_path=tmp_path,
        max_skill_instruction_chars=4_000,
        max_system_prompt_chars=16_000,
        default_supervisor_prompt="Coordinate.",
        preserve_instructions=False,
    )
    assert "x" * 4_000 in bounded.combined_persona
    assert "x" * 4_001 not in bounded.combined_persona


def test_build_prompts_omits_out_of_scope_when_empty_or_none(tmp_path: Path) -> None:
    for value in ("   ", None):
        agent_data = {"id": "writer", "persona": "Draft notes.", "out_of_scope": value, "_execution_detailed_persona": ""}
        prompt_setup = build_prompts(
            _profile_setup(agent_data),
            _model_setup(),
            active_skill_ids=None,
            vault_path=tmp_path,
            memory_user_id="user-1",
            reviewed_memory_rows=[],
            user_message="Hello.",
            instructions_dir=tmp_path,
            default_vault_path=tmp_path,
            max_skill_instruction_chars=4_000,
            max_system_prompt_chars=16_000,
            default_supervisor_prompt="Coordinate.",
        )
        assert "Out of scope" not in prompt_setup.combined_persona


def test_snapshot_revision_budgeting_and_gauntlet_clearing(tmp_path: Path) -> None:
    from backend.services.agent_behavior import snapshot_instruction_text

    scope = ExecutionScope(user_id="u1", workspace_id="w1", role="owner", vault_path=str(tmp_path))
    runtime = SimpleNamespace(active_skill_ids=(), instructions=(), skills=(), catalog_revision="r1")
    snap_a = snapshot_from_runtime(scope, {"id": "a1", "persona": "Write.", "out_of_scope": ""}, runtime)
    snap_b = snapshot_from_runtime(scope, {"id": "a1", "persona": "Write.", "out_of_scope": "No external posts."}, runtime)
    assert snap_a.revision != snap_b.revision
    assert snap_b.profile["out_of_scope"] == "No external posts."
    assert "No external posts." in snapshot_instruction_text(snap_b)

    fresh = _fresh_snapshot(snap_b, "review", "root-1")
    assert fresh.profile["out_of_scope"] == ""
    assert fresh.profile["persona"] == ""
    assert "No external posts." not in snapshot_instruction_text(fresh)


def test_behavior_preview_endpoint_returns_out_of_scope(tmp_path: Path, monkeypatch: Any) -> None:
    from backend.domains.agent.routes.runs import BehaviorPreviewRequest, preview

    scope = ExecutionScope(user_id="u1", workspace_id="w1", role="owner", vault_path=str(tmp_path))
    monkeypatch.setattr("backend.domains.agent.routes.runs.current_scope", lambda: scope)
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: SimpleNamespace(ai={"operation_bindings": {}}, paths={"VAULT": tmp_path}),
    )
    monkeypatch.setattr(
        "backend.services.agent_skill_catalog.resolve_agent_runtime",
        lambda profile, vault_path, active_skill_ids=None: SimpleNamespace(
            skills=[], assigned_skill_ids=(), catalog_revision="rev1", missing_skill_ids=()
        ),
    )
    response = preview(
        BehaviorPreviewRequest(
            profile={
                "id": "a1",
                "persona": "Translate text.",
                "out_of_scope": "Do not summarize or edit source files.",
                "context": "",
                "skill_ids": [],
            }
        )
    )
    assert response["out_of_scope"] == "Do not summarize or edit source files."
