"""Readable, versioned behavior resources and data-only operation requests.

This module is deliberately independent of configuration, providers and storage.
Previewing a resource never initializes an agent or invokes a model.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from contextvars import ContextVar

ROOT = Path(__file__).resolve().parents[1] / "agent" / "behavior"
frozen_resources: ContextVar[dict[str, str] | None] = ContextVar("agent_behavior_resources", default=None)


def resource(name: str) -> str:
    frozen = frozen_resources.get()
    if frozen is not None and name in frozen:
        return frozen[name]
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT.resolve()) or not path.is_file():
        raise ValueError(f"agent_behavior_resource_unavailable:{name}")
    return path.read_text(encoding="utf-8").removesuffix("\n")


def skill_instructions(identifier: str) -> str:
    return resource(f"skills/{identifier}/SKILL.md")


def task_input(task: str, **data: Any) -> str:
    """Serialize an operation identifier and data, without adding methodology."""
    return json.dumps({"task": task, "data": data}, ensure_ascii=False, allow_nan=False)


def operation_input(request: Any) -> str:
    """A stable, inspectable data envelope, including legacy caller input."""
    return json.dumps({"operation": request.operation, "input": request.input,
                       "data": request.data, "options": request.options,
                       "language": request.language, "sources": request.context_refs,
                       "output_schema": request.output_schema}, ensure_ascii=False, allow_nan=False)


def snapshot_instruction_text(snapshot: Any) -> str:
    profile = snapshot.profile
    return "\n\n".join([
        str(profile.get("persona") or ""), str(profile.get("context") or ""),
        str(profile.get("_execution_detailed_persona") or ""),
        *(str(item.get("text") or "") for item in profile.get("_execution_reviewed_memory", [])),
        *snapshot.instructions, snapshot.behavior_resources.get("system/data-boundary.md", ""),
    ])


def profile_defaults(owner: str) -> str:
    identifier = owner.removeprefix("builtin:") if owner.startswith("builtin:") else "principal"
    path = ROOT / "agents" / f"{identifier}.md"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def revision(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def inventory() -> list[dict[str, str]]:
    return [{"path": p.relative_to(ROOT).as_posix(), "revision": revision(p.read_text(encoding="utf-8"))}
            for p in sorted(ROOT.rglob("*")) if p.is_file()]
