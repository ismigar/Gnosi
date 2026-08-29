"""Frozen façade and route contract for the PR6 vault-domain extraction."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi.routing import APIRoute

from backend.api import vault_routes as legacy_vault
from backend.domains.vault.citations import references_api as citation_references
from backend.domains.vault.citations.state import citation_index_state
from backend.domains.vault.comments import schemas as comment_schemas
from backend.domains.vault.comments import state as comment_state
from backend.domains.vault.links import schemas as link_schemas
from backend.domains.vault.links.state import link_index_state


@dataclass(frozen=True)
class ExpectedRoute:
    path: str
    method: str
    endpoint: str
    module: str
    dependency_count: int = 0


EXPECTED_ROUTES = (
    ExpectedRoute(
        "/pages/{page_id}/comments",
        "GET",
        "list_page_comments",
        "backend.domains.vault.comments.api",
        1,
    ),
    ExpectedRoute(
        "/pages/{page_id}/comments",
        "POST",
        "add_page_comment",
        "backend.domains.vault.comments.api",
        2,
    ),
    ExpectedRoute(
        "/pages/{page_id}/comments/{comment_id}",
        "PATCH",
        "update_page_comment",
        "backend.domains.vault.comments.api",
        2,
    ),
    ExpectedRoute(
        "/pages/{page_id}/comments/{comment_id}",
        "DELETE",
        "delete_page_comment",
        "backend.domains.vault.comments.api",
        2,
    ),
    ExpectedRoute(
        "/format-citation",
        "GET",
        "format_citation",
        "backend.domains.vault.citations.formatting",
    ),
    ExpectedRoute(
        "/format-citations",
        "POST",
        "format_citations",
        "backend.domains.vault.citations.formatting",
    ),
    ExpectedRoute(
        "/format-bibliography",
        "POST",
        "format_bibliography",
        "backend.domains.vault.citations.formatting",
    ),
    ExpectedRoute(
        "/reference-table",
        "GET",
        "get_reference_table",
        "backend.domains.vault.citations.references_api",
    ),
    ExpectedRoute(
        "/reference-table",
        "POST",
        "set_reference_table",
        "backend.domains.vault.citations.references_api",
        1,
    ),
    ExpectedRoute(
        "/reference-table/create",
        "POST",
        "create_reference_table",
        "backend.domains.vault.citations.references_api",
        1,
    ),
    ExpectedRoute(
        "/reference-table",
        "DELETE",
        "clear_reference_table",
        "backend.domains.vault.citations.references_api",
        1,
    ),
    ExpectedRoute(
        "/generate-citation-key",
        "POST",
        "generate_citation_key_endpoint",
        "backend.domains.vault.citations.keys_api",
    ),
    ExpectedRoute(
        "/import-references",
        "POST",
        "import_references",
        "backend.domains.vault.citations.io_api",
        1,
    ),
    ExpectedRoute(
        "/csl/styles",
        "GET",
        "list_csl_styles",
        "backend.domains.vault.citations.io_api",
    ),
    ExpectedRoute(
        "/csl/styles",
        "POST",
        "upload_csl_style",
        "backend.domains.vault.citations.io_api",
        1,
    ),
    ExpectedRoute(
        "/export-references",
        "GET",
        "export_references",
        "backend.domains.vault.citations.io_api",
        1,
    ),
    ExpectedRoute(
        "/search-citations",
        "GET",
        "search_citations",
        "backend.domains.vault.citations.search",
    ),
    ExpectedRoute(
        "/resolve-by-citation-key",
        "GET",
        "resolve_by_citation_key",
        "backend.domains.vault.citations.search",
    ),
    ExpectedRoute(
        "/global-index",
        "GET",
        "get_global_index",
        "backend.domains.vault.links.api.overview",
    ),
    ExpectedRoute(
        "/alias-index",
        "GET",
        "get_alias_index",
        "backend.domains.vault.links.api.overview",
    ),
    ExpectedRoute(
        "/link-preview",
        "GET",
        "get_link_preview",
        "backend.domains.vault.links.api.preview",
    ),
    ExpectedRoute(
        "/pages/{page_id}/inline-comments",
        "GET",
        "list_inline_comments",
        "backend.domains.vault.comments.api",
    ),
    ExpectedRoute(
        "/pages/{page_id}/inline-comments",
        "POST",
        "create_inline_comment",
        "backend.domains.vault.comments.api",
        1,
    ),
    ExpectedRoute(
        "/pages/{page_id}/inline-comments/{comment_id}",
        "PATCH",
        "update_inline_comment",
        "backend.domains.vault.comments.api",
        1,
    ),
    ExpectedRoute(
        "/pages/{page_id}/inline-comments/{comment_id}",
        "DELETE",
        "delete_inline_comment",
        "backend.domains.vault.comments.api",
        1,
    ),
    ExpectedRoute(
        "/link-index/stats",
        "GET",
        "get_link_index_stats",
        "backend.domains.vault.links.api.navigation",
    ),
    ExpectedRoute(
        "/link-index/rebuild",
        "POST",
        "post_link_index_rebuild",
        "backend.domains.vault.links.api.navigation",
        1,
    ),
    ExpectedRoute(
        "/backlinks",
        "GET",
        "get_backlinks",
        "backend.domains.vault.links.api.navigation",
    ),
    ExpectedRoute(
        "/outlinks",
        "GET",
        "get_outlinks",
        "backend.domains.vault.links.api.navigation",
    ),
    ExpectedRoute(
        "/unlinked-mentions",
        "GET",
        "get_unlinked_mentions",
        "backend.domains.vault.links.api.mentions",
    ),
    ExpectedRoute(
        "/link-unlinked-mentions",
        "POST",
        "link_unlinked_mentions",
        "backend.domains.vault.links.api.mentions",
        1,
    ),
)


def _owned_routes() -> list[APIRoute]:
    endpoint_names = {expected.endpoint for expected in EXPECTED_ROUTES}
    return [
        route
        for route in legacy_vault.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in endpoint_names
    ]


def test_extracted_routes_preserve_order_contract_and_facade_identity() -> None:
    routes = _owned_routes()
    assert len(routes) == len(EXPECTED_ROUTES)
    for route, expected in zip(routes, EXPECTED_ROUTES, strict=True):
        assert route.path == expected.path
        assert route.methods == {expected.method}
        assert route.endpoint.__name__ == expected.endpoint
        assert route.endpoint.__module__ == expected.module
        assert route.endpoint is getattr(legacy_vault, expected.endpoint)
        expected_response_model = {
            "add_page_comment": comment_schemas.PageComment,
            "create_inline_comment": comment_schemas.InlineComment,
            "delete_inline_comment": comment_schemas.CommentDeleteResponse,
            "delete_page_comment": comment_schemas.CommentDeleteResponse,
            "get_alias_index": link_schemas.AliasIndexResponse,
            "get_global_index": link_schemas.GlobalIndexResponse,
            "list_inline_comments": list[comment_schemas.InlineComment],
            "list_page_comments": comment_schemas.PageCommentThread,
            "update_inline_comment": comment_schemas.InlineComment,
            "update_page_comment": comment_schemas.PageComment,
        }.get(route.endpoint.__name__)
        assert route.response_model == expected_response_model
        # APIRouter contributes get_workspace_context to every route; the
        # frozen count records only the route-local dependencies above it.
        assert len(route.dependencies) == expected.dependency_count + 1


def test_extracted_request_models_keep_legacy_identity() -> None:
    for model_name in (
        "CommentCreateRequest",
        "CommentUpdateRequest",
        "InlineCommentRequest",
        "InlineCommentPatch",
    ):
        assert getattr(legacy_vault, model_name) is getattr(comment_schemas, model_name)
    assert legacy_vault.LinkMentionsRequest is link_schemas.LinkMentionsRequest
    assert legacy_vault._REFERENCE_SCHEMA is citation_references.REFERENCE_SCHEMA


def test_extracted_domains_are_the_single_mutable_state_owners() -> None:
    assert legacy_vault._comments_lock is comment_state.page_comments_io_lock
    assert legacy_vault._comments_mutation_lock is comment_state.page_comments_mutation_lock
    assert (
        legacy_vault._inline_comments_mutation_lock is comment_state.inline_comments_mutation_lock
    )

    link_bindings = {
        "_outlinks_by_source": "outlinks_by_source",
        "_outlink_kinds_by_source": "outlink_kinds_by_source",
        "_backlinks_by_target": "backlinks_by_target",
        "_backlinks_by_target_title": "backlinks_by_target_title",
        "_tokens_by_source": "tokens_by_source",
        "_page_meta_by_id": "page_meta_by_id",
        "_link_index_lock": "lock",
        "_link_index_persist_lock": "persist_lock",
        "_link_index_rebuild_state_lock": "rebuild_state_lock",
    }
    for legacy_name, state_name in link_bindings.items():
        assert getattr(legacy_vault, legacy_name) is getattr(link_index_state, state_name)
    assert legacy_vault._link_index_built is link_index_state.built
    assert legacy_vault._link_index_build_ts == link_index_state.build_ts
    assert legacy_vault._link_index_source_count == link_index_state.source_count

    assert legacy_vault._cite_key_index is citation_index_state.indexes
    assert legacy_vault._cite_key_index_size_at_build is citation_index_state.sizes_at_build
    assert legacy_vault._cite_key_index_lock is citation_index_state.lock


def test_legacy_helper_facade_remains_available() -> None:
    helper_names = (
        "_get_comments_path",
        "_load_comments",
        "_save_comments",
        "_inline_comments_path",
        "_load_inline_comments",
        "_extract_outlinks_with_kinds",
        "_extract_outlinks_from_doc",
        "_tokenize_body_for_mentions",
        "update_link_index_for_page",
        "remove_from_link_index",
        "rewrite_wikilinks_on_title_change",
        "_parse_authors_to_csl",
        "_recursos_metadata_to_csl",
        "_resolve_csl_path",
        "_build_csl_items_for_keys",
        "_extract_csl_entries",
        "generate_citation_key",
        "_existing_citation_keys",
        "_inject_citation_key",
        "_build_dedup_indexes",
        "_collect_table_reference_metas",
        "_ensure_cite_key_index",
        "_invalidate_cite_key_index",
    )
    assert all(callable(getattr(legacy_vault, name)) for name in helper_names)
