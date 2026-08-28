"""Canonical academic literature domain."""

from backend.domains.literature.repositories import (
    catalog,
    delete_repository,
    public_configuration,
    save_config,
    save_repository,
    test_repository,
)
from backend.domains.literature.search import (
    append_search_ai_audit,
    cancel_search,
    discover_citation_neighbors,
    get_search,
    get_search_result,
    list_searches,
    search_events,
    start_search,
)
from backend.domains.literature.sync import (
    cancel_sync,
    enqueue_due_review_updates,
    enqueue_due_syncs,
    enqueue_sync,
    sync_status,
)

__all__ = [
    "append_search_ai_audit",
    "cancel_search",
    "cancel_sync",
    "catalog",
    "delete_repository",
    "discover_citation_neighbors",
    "enqueue_due_review_updates",
    "enqueue_due_syncs",
    "enqueue_sync",
    "get_search",
    "get_search_result",
    "list_searches",
    "public_configuration",
    "save_config",
    "save_repository",
    "search_events",
    "start_search",
    "sync_status",
    "test_repository",
]
