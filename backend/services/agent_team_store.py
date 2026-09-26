"""Private team artifacts, scoped through the owning execution record."""
from __future__ import annotations

import json
from typing import Any

from backend.services import agent_execution_store as runs
from backend.services.agent_execution_models import ExecutionScope


def _schema(db: Any) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS agent_team_artifacts (run_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,id))")


def put(scope: ExecutionScope, run_id: str, identifier: str, kind: str, payload: dict[str, Any], *, create_only: bool = False) -> None:
    with runs.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        runs._row(db, scope, run_id)
        _schema(db)
        if create_only and kind in {"task", "temporary"}:
            count = db.execute("SELECT COUNT(*) FROM agent_team_artifacts WHERE run_id=? AND kind=?", (run_id, kind)).fetchone()[0]
            if count >= (4 if kind == "task" else 2):
                raise RuntimeError("agent_team_artifact_limit")
        verb = "INSERT" if create_only else "INSERT OR REPLACE"
        db.execute(f"{verb} INTO agent_team_artifacts VALUES (?,?,?,?)", (run_id, identifier, kind, json.dumps(payload, ensure_ascii=False)))


def get(scope: ExecutionScope, run_id: str, identifier: str) -> dict[str, Any]:
    with runs.connect() as db:
        runs._row(db, scope, run_id)
        _schema(db)
        row = db.execute("SELECT payload FROM agent_team_artifacts WHERE run_id=? AND id=?", (run_id, identifier)).fetchone()
        if row is None:
            raise LookupError("agent_team_artifact_not_found")
        return json.loads(row[0])


def list_artifacts(scope: ExecutionScope, kind: str, run_id: str = "") -> list[dict[str, Any]]:
    with runs.connect() as db:
        _schema(db)
        rows = db.execute("""SELECT a.payload FROM agent_team_artifacts a JOIN agent_runs r ON r.run_id=a.run_id
            WHERE r.user_id=? AND r.workspace_id=? AND r.vault_path=? AND a.kind=?
            AND (?='' OR a.run_id=?) ORDER BY r.rowid DESC LIMIT 200""",
            (scope.user_id, scope.workspace_id, scope.vault_path, kind, run_id, run_id)).fetchall()
        return [json.loads(row[0]) for row in rows]


def claim_proposal(scope: ExecutionScope, run_id: str, identifier: str, accept: bool) -> dict[str, Any]:
    with runs.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        runs._row(db, scope, run_id)
        _schema(db)
        row = db.execute("SELECT payload FROM agent_team_artifacts WHERE run_id=? AND id=? AND kind='proposal'", (run_id, identifier)).fetchone()
        if row is None:
            raise LookupError("agent_team_proposal_not_found")
        proposal = json.loads(row[0])
        if proposal["status"] != "pending":
            raise ValueError("agent_team_proposal_already_reviewed")
        proposal["status"] = "accepting" if accept else "rejected"
        db.execute("UPDATE agent_team_artifacts SET payload=? WHERE run_id=? AND id=?", (json.dumps(proposal), run_id, identifier))
        return proposal


def retain(scope: ExecutionScope, run_id: str, identifier: str, *, accept: bool, name: str = "", instructions: str | None = None, add_to_team: bool = False) -> dict[str, Any]:
    """The HTTP administrator action is the only permanent-profile writer."""
    if scope.role not in {"admin", "owner"}:
        raise PermissionError("agent_team_admin_required")
    from backend.config.app_config import load_params
    from backend.services.agent_skill_assignments import AgentSkillAssignmentStore
    from backend.services.agent_team_models import TemporaryAgentSpec
    from backend.services.agent_team_runtime import validate_temporary
    proposal = get(scope, run_id, identifier)
    if proposal["status"] == "accepted" and accept:
        return proposal
    from backend.services.agent_team_retention import reusable_instructions
    if proposal.get("instructions_origin") != "registered_skills_template_v1":
        proposal["instructions"] = reusable_instructions(proposal["skill_ids"])
    if instructions is not None:
        proposal["instructions"] = instructions
    if accept:
        owner = runs.read(scope, run_id)
        cfg = load_params(strict_env=False)
        source = next((p for p in cfg.ai.get("agents", []) if p.get("id") == owner.agent_id), None)
        if source is None:
            raise PermissionError("agent_team_profile_revoked")
        validate_temporary(TemporaryAgentSpec(
            name=name or proposal["name"], instructions=proposal["instructions"], provider=proposal["provider"],
            model=proposal["model"], skill_ids=proposal["skill_ids"], acceptance=proposal["acceptance"],
        ), source, scope)
    reviewed_instructions = proposal["instructions"]
    proposal = claim_proposal(scope, run_id, identifier, accept)
    proposal["instructions"] = reviewed_instructions
    if not accept:
        return proposal
    try:
        assignments = AgentSkillAssignmentStore(cfg.params_source, cfg.params)
        permanent_id = "retained_" + identifier
        with assignments._lock:
            assignments._refresh_if_changed()
            import copy
            ai = assignments.params.setdefault("ai", {})
            original_profiles = ai.get("agents", [])
            profiles = copy.deepcopy(original_profiles)
            if not any(p.get("id") == permanent_id for p in profiles):
                profiles.append({"id": permanent_id, "name": name or proposal["name"],
                    "provider": proposal["provider"], "model": proposal["model"],
                    "persona": proposal["instructions"], "skill_ids": proposal["skill_ids"],
                    "enabled": True, "context": "", "context_refs": [],
                    "team": {"enabled": False}, "retained_from": identifier})
            if add_to_team:
                owning_profile = next((p for p in profiles if p.get("id") == owner.agent_id), None)
                if not owning_profile or not owning_profile.get("team", {}).get("enabled"):
                    raise PermissionError("agent_team_revoked")
                members = owning_profile["team"].setdefault("members", [])
                if not any(m["agent_id"] == permanent_id for m in members):
                    if len(members) >= 32:
                        raise ValueError("agent_team_member_limit")
                    members.append({"agent_id": permanent_id, "roles": []})
            ai["agents"] = profiles
            try:
                assignments.save()
            except BaseException:
                ai["agents"] = original_profiles
                raise
        proposal.update(status="accepted", permanent_agent_id=permanent_id)
    except BaseException:
        proposal["status"] = "pending"
        put(scope, run_id, identifier, "proposal", proposal)
        raise
    put(scope, run_id, identifier, "proposal", proposal)
    return proposal
