"""Small routing evidence; executors still receive the original conversation."""
from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import messages_to_dict

from backend.services.agent_team_policy import team_for


def excerpt(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    marker = "\n[… excerpt; full text is available to the executor …]\n"
    remaining = limit - len(marker)
    return text[:remaining * 3 // 4] + marker + text[-(remaining - remaining * 3 // 4):]


def visible_text(message: Any) -> str:
    metadata = getattr(message, "additional_kwargs", {}) or {}
    return str(metadata.get("gnosi_visible_content", message.text))


def compact_catalog(catalog: list[dict[str, Any]], authorized_tool_names: set[str] | None = None) -> dict[str, Any]:
    from backend.services.agent_team_actions import skill_tool_names
    members, capabilities = [], {}
    for member in catalog:
        skills = []
        for capability in member["capabilities"]:
            if not capability["available"]:
                continue
            identifier = capability["id"]
            skills.append(identifier)
            capabilities[identifier] = {
                "name": capability["name"],
                "description": excerpt(capability["description"], 180),
                **({"application_operation": capability["application_operation"]} if capability.get("application_operation") else {}),
                **({"canonical_id": capability["canonical_id"]} if identifier != capability["canonical_id"] else {}),
                **({"action_tools": sorted(action_tools)} if (action_tools := skill_tool_names(member, [identifier]).intersection(authorized_tool_names or set())) else {}),
            }
        # Some runtime integrations only expose assigned IDs.
        described = {c["id"] for c in member["capabilities"]} | {c["canonical_id"] for c in member["capabilities"]}
        skills.extend(s for s in member["skills"] if s not in described)
        entry = {"id": member["id"], "name": member["name"], "roles": member["roles"],
                 "skills": skills, "available": member["available"]}
        if not member["available"]:
            entry["availability_reason"] = member["availability_reason"]
        effects = sorted({effect for tool in member["tools"] for effect in tool["effects"]})
        if effects:
            entry["effects"] = effects
        members.append(entry)
    return {"members": members, "capabilities": capabilities}


def context_inventory(refs: list[dict[str, Any]]) -> dict[str, Any]:
    """Describe source types/selection sizes without copying documents or row lists."""
    selections = []
    for ref in refs[:12]:
        item: dict[str, Any] = {key: excerpt(str(ref[key]), 160) for key in ("type", "id", "ref", "name", "label") if key in ref}
        scope = ref.get("scope") or {}
        if isinstance(scope, dict):
            selection: dict[str, Any] = {key: excerpt(str(scope[key]), 120) for key in ("view_id", "table_id", "document_id") if key in scope}
            for key in ("row_ids", "filters", "fields"):
                if isinstance(scope.get(key), list):
                    selection[key + "_count"] = len(scope[key])
            if selection:
                item["selection"] = selection
        selections.append(item)
    return {"count": len(refs), "selections": selections, "omitted": max(0, len(refs) - len(selections))}


def planning_input(owner: dict[str, Any], state: dict[str, Any], original: str,
                   catalog: list[dict[str, Any]], refs: list[dict[str, Any]],
                   *, operation_mode: bool) -> tuple[dict[str, Any], dict[str, int]]:
    messages = list(state.get("messages") or [])
    current = messages[-1] if messages and messages[-1].type == "human" else None
    history = messages[:-1] if current is not None else messages
    turns = [m for m in history if m.type in {"human", "ai"} and not getattr(m, "tool_calls", None)]
    recent = [{"role": m.type, "text": excerpt(visible_text(m), 800)} for m in turns[-4:]]
    payload = {
        "request": excerpt(original, 6000), "request_truncated": len(original) > 6000,
        **compact_catalog(catalog, set(state.get("turn_authorized_tool_names") or [])), "temporary_policy": team_for(owner).temporary.model_dump(),
        "allow_direct_response": not operation_mode, "context_refs": context_inventory(refs),
        "authorized_tool_names": list(state.get("turn_authorized_tool_names") or []),
        "recent_conversation": recent, "omitted_conversation_messages": len(history) - len(recent),
        "current_message_has_source_context": current is not None and current.text != original,
    }
    # A local size comparison, not a token estimate or a second model invocation.
    previous = {"request": original, "members": catalog, "temporary_policy": team_for(owner).temporary.model_dump(),
                "allow_direct_response": not operation_mode, "context_refs": refs,
                "authorized_tool_names": list(state.get("turn_authorized_tool_names") or []),
                "conversation_evidence": messages_to_dict(messages)}
    sizes = {"full_context_chars": len(json.dumps(previous, ensure_ascii=False)),
             "sent_context_chars": len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))}
    return payload, sizes
