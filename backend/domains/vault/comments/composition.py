"""Checked comment composition invoked at the historical registration point."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from backend.domains.vault.comments.api import CommentDependencies
from backend.domains.vault.comments.repository import PageCommentMap


def _get_comments_path() -> Path:
    from backend.api import vault_routes as legacy

    return legacy.comments_repository.comments_path(legacy.get_p)


def _load_comments() -> PageCommentMap:
    from backend.api import vault_routes as legacy

    return legacy.comments_repository.load_page_comments(_get_comments_path)


def _save_comments(data: PageCommentMap) -> None:
    from backend.api import vault_routes as legacy

    legacy.comments_repository.save_page_comments(
        _get_comments_path, legacy.safe_write_json, data
    )


def build_dependencies() -> CommentDependencies:
    from backend.api import vault_routes as legacy

    return legacy.comments_api.CommentDependencies(
        resolve_page_loader=lambda: legacy._load_comments,
        resolve_page_saver=lambda: legacy._save_comments,
        resolve_inline_loader=lambda: legacy._load_inline_comments,
        resolve_inline_path=lambda: legacy._inline_comments_path,
        resolve_json_writer=lambda: legacy.safe_write_json,
    )


def register_page_comments(
    dependencies: CommentDependencies,
) -> tuple[Callable[..., object], ...]:
    from backend.api import vault_routes as legacy

    return legacy.comments_api.register_page_comment_routes(
        legacy.router,
        get_dependencies=[legacy.Depends(legacy.require_plugins("page-comments"))],
        post_dependencies=[
            legacy.Depends(legacy.require_role("editor")),
            legacy.Depends(legacy.require_plugins("page-comments")),
        ],
        patch_dependencies=[
            legacy.Depends(legacy.require_role("editor")),
            legacy.Depends(legacy.require_plugins("page-comments")),
        ],
        delete_dependencies=[
            legacy.Depends(legacy.require_role("editor")),
            legacy.Depends(legacy.require_plugins("page-comments")),
        ],
        workspace_context_dependency=legacy.get_workspace_context,
        dependencies=dependencies,
    )
