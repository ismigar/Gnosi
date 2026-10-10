"""Reuse a verified text specialist for narrowly unambiguous follow-up edits."""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from backend.services.agent_behavior import revision
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_operation_catalog import skill_id
from backend.services.agent_team_context import visible_text
from backend.services.agent_team_models import TeamPlan, TeamTask
from backend.services import agent_execution_store as runs, agent_team_store as artifacts

TEXT_SKILLS = {skill_id(operation) for operation in ("writing", "translation")}


def clear_text_revision(text: str) -> bool:
    """Match the whole request; extra goals, new sources and bare assent replan."""
    normalized = "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))
    normalized = re.sub(r"\s+", " ", normalized.replace("’", "'")).strip().rstrip(".! ")
    patterns = (
        r"(?:ara )?(?:fes(?:-ho|-la|-lo)?|fes (?:la mateixa frase|el mateix text|aquesta frase|aquest text)) "
        r"(?:mes (?:formal|informal|breu|curt|curta|clar|clara|senzill|senzilla)|menys formal)"
        r"(?:,? mantenint(?:-ne)? el sentit)?(?:\. retorna nomes (?:la frase|el text))?",
        r"(?:ahora )?(?:hazlo|hazla|haz (?:la misma frase|el mismo texto)) "
        r"(?:mas (?:formal|informal|breve|corto|corta|claro|clara|sencillo|sencilla)|menos formal)"
        r"(?:,? manteniendo el sentido)?(?:\. devuelve solo (?:la frase|el texto))?",
        r"(?:please )?(?:now )?make (?:it|that|the same (?:sentence|text)) "
        r"(?:(?:more|less) (?:formal|detailed)|shorter|clearer|simpler)"
        r"(?:,? (?:keeping|preserving) (?:its |the )?meaning)?(?:\. return only the (?:sentence|text))?",
        r"(?:maintenant,? )?(?:rends?(?:-le|-la)?|rends (?:la meme phrase|le meme texte)) "
        r"(?:plus (?:formel|formelle|court|courte|clair|claire|simple)|moins (?:formel|formelle))"
        r"(?:,? en conservant le sens)?(?:\. retourne seulement (?:la phrase|le texte))?",
    )
    return len(normalized) <= 240 and any(re.fullmatch(pattern, normalized) for pattern in patterns)


def routing_fingerprint(owner: dict[str, Any], catalog: list[dict[str, Any]], refs: list[dict[str, Any]],
                        scope: ExecutionScope) -> str:
    from backend.services.agent_team_runtime import _profile, _runtime
    profiles = [_profile(member["id"]) for member in catalog]
    return revision({"owner": owner, "members": catalog, "profiles": profiles, "refs": refs,
                     "scope": scope.model_dump(),
                     "procedures": {p["id"]: _runtime(p, scope).catalog_revision for p in profiles}})


def continuation_plan(owner: dict[str, Any], scope: ExecutionScope, state: dict[str, Any], original: str,
                      catalog: list[dict[str, Any]], refs: list[dict[str, Any]]) -> tuple[TeamPlan, str] | None:
    from backend.services.agent_team_routing import validate_assignments
    if not clear_text_revision(original) or state.get("turn_authorized_tool_names"):
        return None
    messages = list(state.get("messages") or [])
    if len(messages) < 3 or [m.type for m in messages[-3:]] != ["human", "ai", "human"]:
        return None
    previous_user, previous, current = messages[-3:]
    if current.text != original:  # Attachments/mentions add new evidence and must be routed.
        return None
    marker = previous.additional_kwargs.get("gnosi_team_route")
    if not isinstance(marker, dict) or not isinstance(marker.get("run_id"), str):
        return None
    try:
        prior = runs.read(scope, marker["run_id"])
        saved = artifacts.get(scope, prior.run_id, "continuation")
        if prior.status != "completed" or prior.agent_id != owner["id"]:
            return None
        if saved["fingerprint"] != routing_fingerprint(owner, catalog, refs, scope):
            return None
        if saved["response_hash"] != revision(previous.text) or saved["request_hash"] != revision(visible_text(previous_user)):
            return None
        task = TeamTask(id="continuation", agent_id=saved["agent_id"], skill_ids=saved["skill_ids"],
                        objective=original, read_only=True)
        plan = TeamPlan(tasks=[task], result_task=task.id)
        validate_assignments(plan, catalog, owner["id"])
        return plan, prior.run_id
    except (LookupError, ValueError, KeyError, PermissionError):
        return None


def remember_specialist(owner: dict[str, Any], scope: ExecutionScope, root_id: str, state: dict[str, Any],
                        plan: TeamPlan, catalog: list[dict[str, Any]], refs: list[dict[str, Any]],
                        result: str) -> dict[str, str]:
    if len(plan.tasks) != 1 or plan.synthesize or plan.response or plan.output_schema_json:
        return {}
    task = plan.tasks[0]
    if not task.read_only or task.temporary or task.agent_id == owner["id"]:
        return {}
    member = next(m for m in catalog if m["id"] == task.agent_id)
    canonical = {c["id"]: c["canonical_id"] for c in member["capabilities"] if c["available"]}
    if not {canonical.get(s, s) for s in task.skill_ids}.issubset(TEXT_SKILLS):
        return {}
    last_user = next((m for m in reversed(state.get("messages", [])) if m.type == "human"), None)
    if last_user is None:
        return {}
    artifacts.put(scope, root_id, "continuation", "continuation", {
        "agent_id": task.agent_id, "skill_ids": task.skill_ids,
        "fingerprint": routing_fingerprint(owner, catalog, refs, scope),
        "request_hash": revision(visible_text(last_user)), "response_hash": revision(result),
    })
    return {"run_id": root_id}
