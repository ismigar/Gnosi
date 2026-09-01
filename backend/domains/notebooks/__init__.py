"""Canonical grounded-notebook domain."""

from backend.domains.notebooks.analysis import (
    get_notebook_analysis,
    start_notebook_analysis,
)
from backend.domains.notebooks.chat import (
    inspect_notebook,
    resolve_chat_context,
    resolve_chat_contexts,
)
from backend.domains.notebooks.evidence import (
    read_notebook_evidence,
    search_notebook,
)
from backend.domains.notebooks.service import (
    add_resources,
    cancel_refresh,
    create_notebook,
    delete_notebook,
    get_notebook,
    list_chat_source_options,
    list_notebook_sources,
    list_notebooks,
    remove_resource,
    request_refresh,
    update_notebook,
)

__all__ = [
    "add_resources",
    "cancel_refresh",
    "create_notebook",
    "delete_notebook",
    "get_notebook",
    "get_notebook_analysis",
    "inspect_notebook",
    "list_chat_source_options",
    "list_notebook_sources",
    "list_notebooks",
    "read_notebook_evidence",
    "remove_resource",
    "request_refresh",
    "resolve_chat_context",
    "resolve_chat_contexts",
    "search_notebook",
    "start_notebook_analysis",
    "update_notebook",
]
