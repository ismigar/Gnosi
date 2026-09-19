"""Governed academic discovery and local review inspection adapters."""

from langchain_core.tools import tool

from backend.agent.feature_tool_support import (
    feature_context,
    require_primary_workspace,
    result_json,
)


@tool
def literature_sources() -> str:
    """List configured academic search sources and their availability, without secrets."""
    from backend.services import literature_service as service

    context = feature_context("resources")
    # Custom repositories can carry transport settings. Expose only the fields
    # needed to choose a source, never their URLs, headers or configuration.
    fields = {"id", "name", "description", "kind", "group", "enabled", "automated", "available"}
    sources = [
        {key: item[key] for key in fields if key in item}
        for item in service.catalog(context.vault_path)
    ]
    return result_json({"sources": sources})


@tool
def literature_list_searches(limit: int = 25) -> str:
    """List recent academic searches in this Vault with IDs and progress."""
    from backend.services import literature_service as service

    context = feature_context("resources")
    return result_json(
        {"searches": service.list_searches(context.vault_path, max(1, min(limit, 50)))}
    )


@tool
def literature_start_search(query: str, source_ids: list[str], limit_per_source: int = 25) -> str:
    """Start a bounded search in up to 10 configured academic sources; returns a job ID."""
    from backend.services import literature_service as service

    context = feature_context("resources", "editor")
    if not query.strip() or not 1 <= len(source_ids) <= 10:
        raise ValueError("Provide a query and between 1 and 10 configured source IDs.")
    available = {
        item["id"]
        for item in service.catalog(context.vault_path)
        if item.get("enabled") and item.get("automated") and item.get("available")
    }
    if any(item not in available for item in source_ids):
        raise ValueError("Select enabled source IDs from literature_sources.")
    return result_json(
        service.start_search(
            context.vault_path,
            query=query[:2000],
            filters={},
            source_ids=source_ids,
            source_queries={},
            ai_audits=[],
            limit_per_source=max(1, min(limit_per_source, 50)),
            owner_user_id=context.user_id,
        )
    )


@tool
def literature_read_search(search_id: str, offset: int = 0, limit: int = 25) -> str:
    """Read an academic search's progress and a page of results; never starts a search."""
    from backend.services import literature_service as service

    context = feature_context("resources")
    return result_json(
        service.get_search(
            context.vault_path, search_id, offset=max(0, offset), limit=max(1, min(limit, 50))
        )
    )


@tool
def literature_read_result(search_id: str, result_id: str) -> str:
    """Read one exact academic result, including source identifiers and metadata."""
    from backend.services import literature_service as service

    context = feature_context("resources")
    return result_json(service.get_search_result(context.vault_path, search_id, result_id))


@tool
async def literature_import_result(search_id: str, result_id: str) -> str:
    """Import one existing search result into Resources; preserves normal duplicate checks."""
    from fastapi import BackgroundTasks
    from backend.services import literature_service, literature_import_service

    context = feature_context("resources", "editor")
    require_primary_workspace(context)
    work = literature_service.get_search_result(context.vault_path, search_id, result_id)
    tasks = BackgroundTasks()
    result = await literature_import_service.import_works([work], tasks, context)
    await tasks()
    return result_json(result)


@tool
def literature_list_reviews() -> str:
    """List systematic reviews in the active Vault to obtain exact review IDs."""
    from backend.services import literature_review_service as service

    require_primary_workspace(feature_context("resources"))
    return result_json({"reviews": service.list_reviews()})


@tool
def literature_read_review(review_id: str) -> str:
    """Read one review's protocol, decisions and PRISMA audit under the user's role."""
    from backend.services import literature_review_service as service

    context = feature_context("resources")
    require_primary_workspace(context)
    return result_json(service.review_audit(review_id, context))


LITERATURE_READ_TOOLS = [
    literature_sources,
    literature_list_searches,
    literature_read_search,
    literature_read_result,
    literature_list_reviews,
    literature_read_review,
]
LITERATURE_WRITE_TOOLS = [literature_start_search, literature_import_result]
