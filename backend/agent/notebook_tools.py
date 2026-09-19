"""Assignable notebook lifecycle and evidence tools with workspace ACLs."""

from langchain_core.tools import tool

from backend.agent.feature_tool_support import feature_context, result_json


@tool
def notebook_list(query: str = "", page: int = 1, limit: int = 25) -> str:
    """Find accessible notebooks by title; returns IDs, state and pagination."""
    from backend.services import notebook_service as service

    return result_json(
        service.list_notebooks(
            feature_context("grounded-notebooks"),
            query=query[:200],
            page=max(1, page),
            page_size=max(1, min(limit, 50)),
        )
    )


@tool
def notebook_read(notebook_id: str) -> str:
    """Read a notebook's status and revision without starting indexing or AI."""
    from backend.services import notebook_service as service

    return result_json(
        service.get_notebook(
            notebook_id, feature_context("grounded-notebooks"), schedule_refresh=False
        )
    )


@tool
def notebook_list_sources(notebook_id: str, page: int = 1, limit: int = 25) -> str:
    """List one accessible notebook's sources, extraction state and exact IDs."""
    from backend.services import notebook_service as service

    return result_json(
        service.list_notebook_sources(
            notebook_id,
            feature_context("grounded-notebooks"),
            page=max(1, page),
            page_size=max(1, min(limit, 50)),
        )
    )


@tool
def notebook_search(notebook_id: str, query: str, revision: int, limit: int = 12) -> str:
    """Search an exact notebook revision for evidence and stable citation IDs."""
    from backend.services import notebook_service as service

    service.authorize(notebook_id, feature_context("grounded-notebooks"))
    if revision < 1 or not query.strip():
        raise ValueError("A positive revision and nonempty query are required.")
    return result_json(
        service.search_notebook(
            notebook_id, query[:2000], revision=revision, limit=max(1, min(limit, 50))
        )
    )


@tool
def notebook_read_evidence(notebook_id: str, chunk_id: str, revision: int) -> str:
    """Read an exact evidence chunk at the revision returned by notebook search."""
    from backend.services import notebook_service as service

    service.authorize(notebook_id, feature_context("grounded-notebooks"))
    if revision < 1:
        raise ValueError("A positive revision is required.")
    return result_json(service.read_notebook_evidence(notebook_id, chunk_id, revision=revision))


@tool
def notebook_create(title: str, resource_ids: list[str]) -> str:
    """Create a private notebook from up to 50 existing Resources and queue indexing."""
    from backend.services import notebook_service as service

    if not 1 <= len(resource_ids) <= 50:
        raise ValueError("Select between 1 and 50 resource IDs.")
    return result_json(
        service.create_notebook(
            feature_context("grounded-notebooks", "editor"),
            title=title,
            visibility="private",
            conversation_mode="private_member",
            resource_ids=resource_ids,
        )
    )


@tool
def notebook_add_sources(notebook_id: str, resource_ids: list[str]) -> str:
    """Add up to 50 existing Resources to an owned notebook and queue indexing."""
    from backend.services import notebook_service as service

    if not 1 <= len(resource_ids) <= 50:
        raise ValueError("Select between 1 and 50 resource IDs.")
    return result_json(
        service.add_resources(
            notebook_id, feature_context("grounded-notebooks", "editor"), resource_ids
        )
    )


@tool
def notebook_rename(notebook_id: str, title: str) -> str:
    """Rename an owned notebook without changing its visibility or access."""
    from backend.services import notebook_service as service

    return result_json(
        service.update_notebook(
            notebook_id, feature_context("grounded-notebooks", "editor"), title=title
        )
    )


@tool
def notebook_refresh(notebook_id: str) -> str:
    """Queue source reindexing for an owned notebook; completion is asynchronous."""
    from backend.services import notebook_service as service

    context = feature_context("grounded-notebooks", "editor")
    service.authorize(notebook_id, context, action="manage")
    return result_json(
        service.request_refresh(notebook_id, context, reason="agent_request", force=True)
    )


@tool
def notebook_cancel_refresh(notebook_id: str) -> str:
    """Request cancellation of source indexing for an owned notebook."""
    from backend.services import notebook_service as service

    return result_json(
        service.cancel_refresh(notebook_id, feature_context("grounded-notebooks", "editor"))
    )


NOTEBOOK_READ_TOOLS = [
    notebook_list,
    notebook_read,
    notebook_list_sources,
    notebook_search,
    notebook_read_evidence,
]
NOTEBOOK_WRITE_TOOLS = [
    notebook_create,
    notebook_add_sources,
    notebook_rename,
    notebook_refresh,
    notebook_cancel_refresh,
]
