"""HTTP registration for page and inline comments."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from fastapi import APIRouter, Depends, HTTPException
from fastapi.params import Depends as DependsParameter

from backend.domains.vault.comments.repository import Comment, PageCommentMap
from backend.domains.vault.comments.schemas import (
    CommentDeleteResponse,
    CommentCreateRequest,
    CommentUpdateRequest,
    InlineComment,
    InlineCommentPatch,
    InlineCommentRequest,
    PageComment,
    PageCommentThread,
)
from backend.domains.vault.comments.state import (
    inline_comments_mutation_lock,
    page_comments_mutation_lock,
)


class JsonWriter(Protocol):
    def __call__(self, path: Path, data: object, **kwargs: object) -> None: ...


PageLoader = Callable[[], PageCommentMap]
PageSaver = Callable[[PageCommentMap], None]
InlineLoader = Callable[[str], list[Comment]]
InlinePathResolver = Callable[[str], Path]


@dataclass(frozen=True)
class CommentDependencies:
    resolve_page_loader: Callable[[], PageLoader]
    resolve_page_saver: Callable[[], PageSaver]
    resolve_inline_loader: Callable[[], InlineLoader]
    resolve_inline_path: Callable[[], InlinePathResolver]
    resolve_json_writer: Callable[[], JsonWriter]


def register_page_comment_routes(
    router: APIRouter,
    *,
    get_dependencies: Sequence[DependsParameter],
    post_dependencies: Sequence[DependsParameter],
    patch_dependencies: Sequence[DependsParameter],
    delete_dependencies: Sequence[DependsParameter],
    workspace_context_dependency: Callable[..., object],
    dependencies: CommentDependencies,
) -> tuple[Callable[..., object], ...]:
    async def list_page_comments(page_id: str) -> dict[str, object]:
        """Returns the comment thread for a page (oldest first)."""
        data = await asyncio.to_thread(dependencies.resolve_page_loader())
        return {"comments": data.get(page_id, [])}

    async def add_page_comment(
        page_id: str,
        request: CommentCreateRequest,
        context: object = Depends(workspace_context_dependency),
    ) -> Comment:
        """Appends a comment to a page's thread."""
        body = (request.body or "").strip()
        if not body:
            raise HTTPException(status_code=422, detail="Comment body cannot be empty")

        comment: Comment = {
            "id": str(uuid.uuid4()),
            "body": body,
            "author": (request.author or "").strip() or "Anònim",
            "author_id": getattr(context, "user_id", None),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": None,
            "resolved": False,
        }
        async with page_comments_mutation_lock:
            data = await asyncio.to_thread(dependencies.resolve_page_loader())
            data.setdefault(page_id, []).append(comment)
            await asyncio.to_thread(dependencies.resolve_page_saver(), data)
        return comment

    async def update_page_comment(
        page_id: str,
        comment_id: str,
        request: CommentUpdateRequest,
    ) -> Comment:
        """Edits a comment's body and/or toggles its resolved flag."""
        async with page_comments_mutation_lock:
            data = await asyncio.to_thread(dependencies.resolve_page_loader())
            thread = data.get(page_id) or []
            target = next(
                (comment for comment in thread if comment.get("id") == comment_id),
                None,
            )
            if not target:
                raise HTTPException(status_code=404, detail="Comment not found")

            if request.body is not None:
                new_body = request.body.strip()
                if not new_body:
                    raise HTTPException(
                        status_code=422,
                        detail="Comment body cannot be empty",
                    )
                target["body"] = new_body
            if request.resolved is not None:
                target["resolved"] = bool(request.resolved)
            target["updated_at"] = datetime.now(timezone.utc).isoformat()
            await asyncio.to_thread(dependencies.resolve_page_saver(), data)
        return target

    async def delete_page_comment(page_id: str, comment_id: str) -> dict[str, str]:
        """Removes a comment from a page's thread."""
        async with page_comments_mutation_lock:
            data = await asyncio.to_thread(dependencies.resolve_page_loader())
            thread = data.get(page_id) or []
            new_thread = [comment for comment in thread if comment.get("id") != comment_id]
            if len(new_thread) == len(thread):
                raise HTTPException(status_code=404, detail="Comment not found")
            if new_thread:
                data[page_id] = new_thread
            else:
                data.pop(page_id, None)
            await asyncio.to_thread(dependencies.resolve_page_saver(), data)
        return {"status": "deleted", "id": comment_id}

    router.add_api_route(
        "/pages/{page_id}/comments",
        list_page_comments,
        methods=["GET"],
        dependencies=list(get_dependencies),
        response_model=PageCommentThread,
    )
    router.add_api_route(
        "/pages/{page_id}/comments",
        add_page_comment,
        methods=["POST"],
        dependencies=list(post_dependencies),
        response_model=PageComment,
    )
    router.add_api_route(
        "/pages/{page_id}/comments/{comment_id}",
        update_page_comment,
        methods=["PATCH"],
        dependencies=list(patch_dependencies),
        response_model=PageComment,
    )
    router.add_api_route(
        "/pages/{page_id}/comments/{comment_id}",
        delete_page_comment,
        methods=["DELETE"],
        dependencies=list(delete_dependencies),
        response_model=CommentDeleteResponse,
    )
    return (
        list_page_comments,
        add_page_comment,
        update_page_comment,
        delete_page_comment,
    )


def register_inline_comment_routes(
    router: APIRouter,
    *,
    post_dependencies: Sequence[DependsParameter],
    patch_dependencies: Sequence[DependsParameter],
    delete_dependencies: Sequence[DependsParameter],
    workspace_context_dependency: Callable[..., object],
    dependencies: CommentDependencies,
) -> tuple[Callable[..., object], ...]:
    async def list_inline_comments(page_id: str) -> list[Comment]:
        return dependencies.resolve_inline_loader()(page_id)

    async def create_inline_comment(
        page_id: str,
        body: InlineCommentRequest,
        context: object = Depends(workspace_context_dependency),
    ) -> Comment:
        item: Comment = {
            "id": str(uuid.uuid4()),
            "quote": (body.quote or "")[:500],
            "comment": body.comment,
            "block_id": body.block_id or "",
            "author_id": getattr(context, "user_id", None),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "resolved": False,
        }
        async with inline_comments_mutation_lock:
            comments = dependencies.resolve_inline_loader()(page_id)
            comments.append(item)
            dependencies.resolve_json_writer()(
                dependencies.resolve_inline_path()(page_id),
                comments,
            )
        return item

    async def update_inline_comment(
        page_id: str,
        comment_id: str,
        body: InlineCommentPatch,
    ) -> Comment:
        async with inline_comments_mutation_lock:
            comments = dependencies.resolve_inline_loader()(page_id)
            found: Comment | None = None
            for comment in comments:
                if comment.get("id") == comment_id:
                    if body.comment is not None:
                        comment["comment"] = body.comment
                    if body.resolved is not None:
                        comment["resolved"] = bool(body.resolved)
                    found = comment
                    break
            if not found:
                raise HTTPException(status_code=404, detail="Comentari no trobat")
            dependencies.resolve_json_writer()(
                dependencies.resolve_inline_path()(page_id),
                comments,
            )
        return found

    async def delete_inline_comment(page_id: str, comment_id: str) -> dict[str, str]:
        async with inline_comments_mutation_lock:
            comments = dependencies.resolve_inline_loader()(page_id)
            new_comments = [comment for comment in comments if comment.get("id") != comment_id]
            if len(new_comments) == len(comments):
                raise HTTPException(status_code=404, detail="Comentari no trobat")
            dependencies.resolve_json_writer()(
                dependencies.resolve_inline_path()(page_id),
                new_comments,
            )
        return {"status": "deleted", "id": comment_id}

    router.add_api_route(
        "/pages/{page_id}/inline-comments",
        list_inline_comments,
        methods=["GET"],
        response_model=list[InlineComment],
    )
    for path, endpoint, method, route_dependencies, response_model in (
        (
            "/pages/{page_id}/inline-comments",
            create_inline_comment,
            "POST",
            post_dependencies,
            InlineComment,
        ),
        (
            "/pages/{page_id}/inline-comments/{comment_id}",
            update_inline_comment,
            "PATCH",
            patch_dependencies,
            InlineComment,
        ),
        (
            "/pages/{page_id}/inline-comments/{comment_id}",
            delete_inline_comment,
            "DELETE",
            delete_dependencies,
            CommentDeleteResponse,
        ),
    ):
        router.add_api_route(
            path,
            endpoint,
            methods=[method],
            dependencies=list(route_dependencies),
            response_model=response_model,
        )
    return (
        list_inline_comments,
        create_inline_comment,
        update_inline_comment,
        delete_inline_comment,
    )


__all__ = [
    "CommentDependencies",
    "register_inline_comment_routes",
    "register_page_comment_routes",
]
