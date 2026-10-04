"""Reconstruct global reading memory from all plans in a legacy checkpoint."""

from typing import Any, cast

from backend.domains.llm_wiki.chunking import encoded


def update_memory(current: str, plan: dict[str, Any]) -> str:
    """Apply exact edits atomically; never silently discard unmentioned memory."""
    if "memory_updates" not in plan:
        memory = plan.get("memory")
        if not isinstance(memory, str) or not memory.strip():
            raise ValueError("global_memory_required: provide memory or memory_updates")
        return memory
    if "memory" in plan:
        raise ValueError("Provide either memory or memory_updates, not both")
    updates = plan["memory_updates"]
    if not isinstance(updates, list) or not 1 <= len(updates) <= 16:
        raise ValueError("memory_updates must contain 1 to 16 exact edits")
    memory = current
    for update in updates:
        if not isinstance(update, dict) or set(update) != {"old", "new"}:
            raise ValueError("Each memory update requires old and new")
        old, new = update["old"], update["new"]
        if not isinstance(old, str) or not isinstance(new, str):
            raise ValueError("Memory edit values must be strings")
        if not old:
            if not new.strip():
                raise ValueError("An appended memory update cannot be empty")
            memory = memory + ("\n" if memory else "") + new
        elif memory.find(old) < 0 or memory.find(old, memory.find(old) + 1) >= 0:
            raise ValueError("memory_edit_anchor_required: old must match exactly once in memory")
        else:
            memory = memory.replace(old, new, 1)
    if not memory.strip():
        raise ValueError("Global memory cannot be empty")
    return memory


def restore_memory(reader: Any, plans: dict[str, Any]) -> str:
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for key, plan in plans.items():
        item = {"chunk_id": key, "notes": plan.get("notes", []), "coverage": plan.get("coverage", [])}
        if current and reader.dependencies.count_tokens(encoded(current + [item])) > reader.budget // 3:
            groups.append(current)
            current = []
        current.append(item)
    if current:
        groups.append(current)
    memory_limit = min(8_000, reader.budget // 8)
    maps = [reader.map(f"resume-memory-{len(plans)}-{i}", "synthesis", {
        "task": "Reconstruct the global argument, qualifications, contradictions and cross-chunk links from these saved reading notes. Keep chunk and evidence ids. Do not change the notes or infer unread content.",
        "saved_plans": group,
    }, summary_limit=memory_limit) for i, group in enumerate(groups)]
    return cast(str, reader.combine(f"resume-memory-{len(plans)}", maps, summary_limit=memory_limit))
