"""Attached context sources for a Cognition agent.

An agent's `context_refs` is a list of REFERENCES (files, pages, tables,
databases, the vault) — never a dump of their content. The prompt only gets an
INVENTORY of what is attached; the agent then reads what it needs through the
tools built here. A whole vault (or a source like the BOE) does not fit in any
context window, so pouring it in is both expensive and lossy.

The tools close over the agent's own refs instead of reading a ContextVar: a
tool can therefore only ever reach a source the user explicitly attached.
`source_id` arrives from the LLM, which reads untrusted content (pages, mail,
PDFs) and is prompt-injectable — the same containment reasoning as
`vault_tools.read_pdf`, but enforced by construction here.

See directive `agent_context_sources.md`.
"""

from __future__ import annotations

import sys
import types
from typing import Any, List, Optional, Tuple

from backend.domains.agent import context_core_tools as core_tools
from backend.domains.agent import context_inventory_tools as inventory_tools
from backend.domains.agent import context_matching as matching
from backend.domains.agent import context_refs as refs
from backend.domains.agent import context_storage as storage
from backend.domains.agent import context_tools as tool_builder

VALID_TYPES = refs.VALID_TYPES
MAX_INVENTORY_ROWS = refs.MAX_INVENTORY_ROWS
MAX_SOURCE_CHARS = refs.MAX_SOURCE_CHARS
dashboard_view_ids = refs.dashboard_view_ids
describe_context_refs = refs.describe_context_refs
merge_context_refs = refs.merge_context_refs
normalize_refs = refs.normalize_refs

INVENTORY_CONCEPT_EXPANSIONS = matching.INVENTORY_CONCEPT_EXPANSIONS
INVENTORY_TYPE_ALIASES = matching.INVENTORY_TYPE_ALIASES
MAX_CONTEXT_INVENTORY_QUERY_CHARS = matching.MAX_CONTEXT_INVENTORY_QUERY_CHARS
MAX_CONTEXT_INVENTORY_ROWS = matching.MAX_CONTEXT_INVENTORY_ROWS
MAX_CONTEXT_TABLE_FIELDS = matching.MAX_CONTEXT_TABLE_FIELDS
MAX_CONTEXT_TABLE_ROWS = matching.MAX_CONTEXT_TABLE_ROWS
MAX_SEARCH_HITS = matching.MAX_SEARCH_HITS
_canonical_metadata = matching._canonical_metadata
_bounded_context_value = matching._bounded_context_value
_inventory_match = matching._inventory_match
_inventory_query_terms = matching._inventory_query_terms
_normalized_phrase = matching._normalized_phrase
_normalized_words = matching._normalized_words
_semantic_token_match = matching._semantic_token_match
_token_trigrams = matching._token_trigrams
_tokenize = matching._tokenize
excerpt_around = matching.excerpt_around
score_text = matching.score_text

_authorized_inventory_tables = storage._authorized_inventory_tables
_describe_table = storage._describe_table
_inventory_table_matches = storage._inventory_table_matches
_page_body = storage._page_body
_page_row = storage._page_row
_page_title = storage._page_title
_read_file_source = storage._read_file_source
_read_source = storage._read_source
_registry = storage._registry
_searchable_page_records = storage._searchable_page_records
_searchable_pages = storage._searchable_pages
_table_entry = storage._table_entry
_table_pages = storage._table_pages
_table_rows = storage._table_rows
_table_view = storage._table_view
_tables_of_database = storage._tables_of_database
_vault_root = storage._vault_root
expand_dashboard_context_refs = storage.expand_dashboard_context_refs

build_context_tools = tool_builder.build_context_tools


def build_context_tool_descriptors(
    raw_refs: Any,
    tools: Optional[List[Any]] = None,
) -> Tuple[Any, ...]:
    """Build governed descriptors for tools scoped to dynamic context refs."""
    refs = normalize_refs(raw_refs)
    if not refs:
        return ()
    runtime_tools = tools if tools is not None else build_context_tools(refs)
    if not runtime_tools:
        return ()

    import hashlib
    import json

    from backend.models.agent_skills import (
        CatalogOrigin,
        ConfirmationPolicy,
        OriginType,
        ToolDescriptor,
        ToolEffect,
    )

    read_effects = [ToolEffect.READ]
    if any(ref["type"] in {"url", "source"} for ref in refs):
        read_effects.append(ToolEffect.EXTERNAL_READ)
    if any(
        ref["type"] == "internal" and ref["ref"] in {"mail", "calendar", "contacts", "meetings"}
        for ref in refs
    ):
        read_effects.append(ToolEffect.PERSONAL_DATA)

    scope_fingerprint = hashlib.sha256(
        json.dumps(
            [
                {
                    "id": ref["id"],
                    "type": ref["type"],
                    "ref": ref["ref"],
                    "scope": ref.get("scope") or {},
                }
                for ref in refs
            ],
            sort_keys=True,
            ensure_ascii=False,
            default=str,
        ).encode("utf-8")
    ).hexdigest()
    origin = CatalogOrigin(type=OriginType.CORE, id="gnosi")
    descriptors = []
    for runtime_tool in runtime_tools:
        name = str(getattr(runtime_tool, "name", "") or getattr(runtime_tool, "__name__", ""))
        if not name:
            continue
        schema_model = getattr(runtime_tool, "args_schema", None)
        input_schema = (
            schema_model.model_json_schema()
            if schema_model is not None
            and callable(getattr(schema_model, "model_json_schema", None))
            else {"type": "object", "properties": {}}
        )
        input_schema.pop("title", None)
        is_reader_analysis_start = name == "start_reader_context_analysis"
        effects = (
            [ToolEffect.LOCAL_WRITE, ToolEffect.AI_COST]
            if is_reader_analysis_start
            else list(read_effects)
        )
        descriptors.append(
            ToolDescriptor(
                id=f"core.gnosi.context-{name.replace('_', '-')}",
                name=name.replace("_", " ").title(),
                description=str(getattr(runtime_tool, "description", "") or ""),
                origin=origin,
                input_schema=input_schema,
                output_schema={"type": "string"},
                effects=list(effects),
                minimum_role="editor" if is_reader_analysis_start else "viewer",
                confirmation=(
                    ConfirmationPolicy.EXPLICIT_REQUEST
                    if is_reader_analysis_start
                    else ConfirmationPolicy.NONE
                ),
                handler_ref=f"runtime-context:{name}",
                metadata={
                    "dynamic_context": True,
                    "source_ids": [ref["id"] for ref in refs],
                    "source_types": sorted({ref["type"] for ref in refs}),
                    "scope_fingerprint": scope_fingerprint,
                },
            )
        )
    return tuple(descriptors)


_PATCHABLE_SEAMS = frozenset(
    {
        "_read_source",
        "_registry",
        "_table_pages",
        "_table_rows",
        "_vault_root",
    }
)
_IMPLEMENTATION_MODULES = (storage, core_tools, inventory_tools, matching)


class _CompatibilityModule(types.ModuleType):
    """Propagate documented historical monkeypatch seams."""

    def __setattr__(self, name: str, value: Any) -> None:
        super().__setattr__(name, value)
        if name not in _PATCHABLE_SEAMS:
            return
        for implementation in _IMPLEMENTATION_MODULES:
            if hasattr(implementation, name):
                setattr(implementation, name, value)


sys.modules[__name__].__class__ = _CompatibilityModule
