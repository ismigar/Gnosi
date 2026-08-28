"""Runtime tools closed over an attached context scope."""

from __future__ import annotations

from typing import Any

from backend.domains.agent.context_refs import normalize_refs

_StructuredTool: Any
try:
    from langchain_core.tools import StructuredTool as ImportedStructuredTool

    _StructuredTool = ImportedStructuredTool
except Exception:  # pragma: no cover - pure helpers remain importable
    _StructuredTool = None


def build_context_tools(raw_refs: Any) -> list[Any]:
    """Build tools scoped to this agent's immutable attached references."""
    refs = normalize_refs(raw_refs)
    if not refs or _StructuredTool is None:
        return []
    from backend.domains.agent.context_core_tools import build_core_context_tools
    from backend.domains.agent.context_inventory_tools import (
        build_inventory_context_tools,
    )
    from backend.domains.agent.context_notebook_tools import (
        build_notebook_context_tools,
    )
    from backend.domains.agent.context_reader_tools import build_reader_context_tools

    inventory_refs = [ref for ref in refs if ref["type"] in {"table", "database", "vault"}]
    notebook_refs = [ref for ref in refs if ref["type"] == "notebook"]
    internal_refs = [ref for ref in refs if ref["type"] == "internal"]
    reader_ref = next(
        (ref for ref in internal_refs if ref["ref"] == "reader"),
        None,
    )
    tools = build_core_context_tools(refs)
    tools[4:4] = build_inventory_context_tools(inventory_refs)
    if reader_ref is not None:
        tools.extend(build_reader_context_tools(reader_ref))
    if notebook_refs:
        tools.extend(build_notebook_context_tools(notebook_refs))
    return tools
