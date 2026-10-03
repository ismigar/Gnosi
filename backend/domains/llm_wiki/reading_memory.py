"""Reconstruct global reading memory from all plans in a legacy checkpoint."""

from typing import Any

from backend.domains.llm_wiki.chunking import encoded


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
    maps = [reader.map(f"resume-memory-{len(plans)}-{i}", "synthesis", {
        "task": "Reconstruct the global argument, qualifications, contradictions and cross-chunk links from these saved reading notes. Keep chunk and evidence ids. Do not change the notes or infer unread content.",
        "saved_plans": group,
    }) for i, group in enumerate(groups)]
    return reader.combine(f"resume-memory-{len(plans)}", maps)
