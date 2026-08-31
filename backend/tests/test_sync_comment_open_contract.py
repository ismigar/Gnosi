"""Synthetic compatibility checks for open comments, imports and SSE ownership."""

from __future__ import annotations

import asyncio
import ast
import inspect
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from pathlib import Path

import pytest
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute

from backend.api import vault_routes as facade
from backend.domains.vault.comments import repository
from backend.domains.vault.comments import composition
from backend.domains.vault.pages import sync_routes
from backend.domains.vault.registry.records import is_record
from backend.domains.vault.translation import lifecycle


@pytest.mark.parametrize("module", [sync_routes, composition, lifecycle])
def test_sync_comment_facade_names_have_declared_owners(module: object) -> None:
    source_path = getattr(module, "__file__")
    assert isinstance(source_path, str)
    source = Path(source_path).read_text(encoding="utf-8")
    assert "_LegacyAny" not in source and "_strict_cast" not in source
    used = {
        node.attr for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
        and node.value.id in {"_legacy", "legacy"}
    }
    root = ast.parse(Path(facade.__file__).read_text(encoding="utf-8"))
    statements = list(root.body)
    for statement in root.body:
        if isinstance(statement, ast.If) and isinstance(statement.test, ast.Name):
            if statement.test.id == "TYPE_CHECKING":
                statements.extend(statement.body)
    declared: set[str] = set()
    for statement in statements:
        if isinstance(statement, (ast.Import, ast.ImportFrom)):
            declared.update(alias.asname or alias.name for alias in statement.names)
        elif isinstance(statement, ast.Assign):
            declared.update(
                target.id for target in statement.targets if isinstance(target, ast.Name)
            )
        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
            declared.add(statement.target.id)
    assert used <= declared, sorted(used - declared)


def _endpoint(name: str) -> Callable[..., object]:
    router: APIRouter = facade.router
    return next(
        route.endpoint
        for route in router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == name
    )


async def _invoke(name: str, *args: object, **kwargs: object) -> object:
    result = _endpoint(name)(*args, **kwargs)
    assert inspect.isawaitable(result)
    value: object = await result
    return value


@pytest.mark.parametrize("decoded", [{"page": [None, 7, {"unknown": True}]}, {8: "opaque"}])
def test_page_comment_repository_preserves_nested_values_and_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, decoded: dict[object, object]
) -> None:
    path = tmp_path / "comments.json"
    path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(json, "loads", lambda _raw: decoded)
    assert repository.load_page_comments(lambda: path) is decoded


@pytest.mark.parametrize("decoded", [[None, 7, {"id": "c", "extension": [False]}], []])
def test_inline_comment_repository_preserves_unvalidated_items(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, decoded: list[object]
) -> None:
    path = tmp_path / "inline.json"
    path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(json, "loads", lambda _raw: decoded)
    assert repository.load_inline_comments(lambda _page: path, "p") is decoded


@pytest.mark.parametrize("raw", ["null", "false", "2", '"scalar"', "broken{"])
def test_comment_root_and_decode_recovery(tmp_path: Path, raw: str) -> None:
    path = tmp_path / "bad.json"
    path.write_text(raw, encoding="utf-8")
    assert repository.load_inline_comments(lambda _page: path, "p") == []
    assert repository.load_page_comments(lambda: path) == {}


def test_inline_path_failure_is_outside_decode_recovery() -> None:
    def missing(_page: str) -> Path:
        raise HTTPException(503, "Synthetic missing vault")

    with pytest.raises(HTTPException) as error:
        repository.load_inline_comments(missing, "p")
    assert error.value.status_code == 503


def test_comment_list_keeps_raw_thread_and_mutation_keeps_native_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document: dict[object, object] = {"p": 7}
    monkeypatch.setattr(facade, "_load_comments", lambda: document)
    assert asyncio.run(_invoke("list_page_comments", "p")) == {"comments": 7}
    with pytest.raises(AttributeError, match="append"):
        asyncio.run(
            _invoke("add_page_comment", "p", facade.CommentCreateRequest(body="Body"))
        )
    assert document == {"p": 7}


def test_inline_update_changes_only_selected_record_and_keeps_list_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first: dict[object, object] = {"id": "c", "comment": "old", 7: {"extension": [None]}}
    second: dict[object, object] = {"id": "c", "comment": "second"}
    comments: list[object] = [first, second]
    writes: list[object] = []
    monkeypatch.setattr(facade, "_load_inline_comments", lambda _page: comments)
    monkeypatch.setattr(facade, "_inline_comments_path", lambda _page: Path("unused-synthetic"))
    monkeypatch.setattr(facade, "safe_write_json", lambda _path, value: writes.append(value))
    response = asyncio.run(
        _invoke("update_inline_comment", "p", "c", facade.InlineCommentPatch(comment="new"))
    )
    assert response is first
    assert writes == [comments] and writes[0] is comments
    assert first == {"id": "c", "comment": "new", 7: {"extension": [None]}}
    assert second == {"id": "c", "comment": "second"}


def test_inline_writer_is_resolved_before_path_callback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comments: list[object] = []
    trace: list[str] = []

    def newer(_path: Path, _value: object) -> None:
        trace.append("new writer")

    def path(_page: str) -> Path:
        trace.append("path")
        monkeypatch.setattr(facade, "safe_write_json", newer)
        return Path("unused-synthetic")

    def original(_path: Path, value: object) -> None:
        trace.append("original writer")
        assert value is comments

    monkeypatch.setattr(facade, "_load_inline_comments", lambda _page: comments)
    monkeypatch.setattr(facade, "_inline_comments_path", path)
    monkeypatch.setattr(facade, "safe_write_json", original)
    result = asyncio.run(_invoke("create_inline_comment", "p", facade.InlineCommentRequest(comment="x")))
    assert is_record(result) and comments[0] is result
    assert trace == ["path", "original writer"]


def test_malformed_inline_item_is_not_silently_removed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comments: list[object] = [None, {"id": "c"}]
    writes: list[object] = []
    monkeypatch.setattr(facade, "_load_inline_comments", lambda _page: comments)
    monkeypatch.setattr(facade, "safe_write_json", lambda *_args: writes.append("unexpected"))
    with pytest.raises(AttributeError, match="get"):
        asyncio.run(_invoke("delete_inline_comment", "p", "c"))
    assert comments == [None, {"id": "c"}] and writes == []


def test_import_preserves_opaque_metadata_and_native_collision_slice(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    from backend.services import context_vars

    target = tmp_path / "Importades"
    target.mkdir()
    (target / "Note.md").write_text("Original", encoding="utf-8")
    metadata: dict[object, object] = {"id": [1, 2], 7: "opaque", "title": None}
    indexed: list[Path] = []
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(facade, "parse_frontmatter", lambda _raw: (metadata, "  Body"))
    monkeypatch.setattr(facade, "register_page_in_index", indexed.append)
    result = asyncio.run(sync_routes.import_markdown(sync_routes.ImportRequest(
        files=[sync_routes.ImportFile(name="Note.md", content="Synthetic")],
    )))
    assert result == {"imported": 1, "errors": [], "folder": "Importades"}
    assert indexed == [target / "Note [1, 2].md"]
    assert metadata == {"id": [1, 2], 7: "opaque", "title": None}
    assert (target / "Note.md").read_text(encoding="utf-8") == "Original"
    written = indexed[0].read_text(encoding="utf-8")
    assert "7: opaque" in written and written.endswith("\n\nBody\n")


def test_import_keeps_per_file_error_after_file_write(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    from backend.services import context_vars

    def index_failure(_path: Path) -> None:
        raise RuntimeError("Synthetic index failure")

    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(facade, "parse_frontmatter", lambda _raw: ({"id": "id"}, "Body"))
    monkeypatch.setattr(facade, "register_page_in_index", index_failure)
    result = asyncio.run(sync_routes.import_markdown(sync_routes.ImportRequest(
        files=[sync_routes.ImportFile(name="Note.md", content="Synthetic")],
    )))
    assert result == {
        "imported": 0,
        "errors": [{"name": "Note.md", "error": "Synthetic index failure"}],
        "folder": "Importades",
    }
    assert (tmp_path / "Importades" / "Note.md").is_file()


def test_sse_frames_vault_scoping_and_finally_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def scenario() -> None:
        monkeypatch.setattr(facade, "_current_vault_key", lambda: "synthetic-vault")
        monkeypatch.setattr(sync_routes, "_synced_subscribers", {})
        response = await sync_routes.synced_events()
        assert isinstance(response, StreamingResponse)
        iterator = response.body_iterator
        assert isinstance(iterator, AsyncGenerator)
        assert len(sync_routes._synced_subscribers) == 1
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        assert await anext(iterator) == "event: ready\ndata: {}\n\n"
        sync_routes._broadcast_synced("foreign", "other-vault")
        sync_routes._broadcast_synced("shared", "synthetic-vault")
        assert await anext(iterator) == 'data: {"syncId": "shared"}\n\n'
        await iterator.aclose()
        assert sync_routes._synced_subscribers == {}

    asyncio.run(scenario())


def test_sse_ping_timeout_and_cancellation_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    async def timeout(awaitable: Awaitable[str], *, timeout: float) -> str:
        assert timeout == 25
        assert inspect.iscoroutine(awaitable)
        awaitable.close()
        raise asyncio.TimeoutError

    async def scenario() -> None:
        monkeypatch.setattr(facade, "_current_vault_key", lambda: "synthetic-vault")
        monkeypatch.setattr(sync_routes, "_synced_subscribers", {})
        monkeypatch.setattr(asyncio, "wait_for", timeout)
        response = await sync_routes.synced_events()
        assert isinstance(response, StreamingResponse)
        iterator = response.body_iterator
        assert isinstance(iterator, AsyncGenerator)
        assert await anext(iterator) == "event: ready\ndata: {}\n\n"
        assert await anext(iterator) == "event: ping\ndata: {}\n\n"
        with pytest.raises(asyncio.CancelledError):
            await iterator.athrow(asyncio.CancelledError())
        assert sync_routes._synced_subscribers == {}

    asyncio.run(scenario())


def test_broadcast_continues_after_failed_subscriber(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenQueue(asyncio.Queue[str]):
        def put_nowait(self, item: str) -> None:
            raise RuntimeError("Synthetic queue failure")

    broken, good, foreign = BrokenQueue(), asyncio.Queue[str](), asyncio.Queue[str]()
    monkeypatch.setattr(sync_routes, "_synced_subscribers", {
        broken: "vault", good: "vault", foreign: "other",
    })
    sync_routes._broadcast_synced("block", "vault")
    assert good.get_nowait() == "block"
    assert broken.empty() and foreign.empty()


def test_inline_delete_preserves_unknown_surviving_items(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    target = tmp_path / "comments.json"
    comments = [{"id": "drop"}, {"id": "keep", "unknown": {"nested": [None]}}]
    target.write_text(json.dumps(comments), encoding="utf-8")
    monkeypatch.setattr(facade, "_load_inline_comments", lambda _page: comments)
    monkeypatch.setattr(facade, "_inline_comments_path", lambda _page: target)
    result = asyncio.run(_invoke("delete_inline_comment", "p", "drop"))
    assert result == {"status": "deleted", "id": "drop"}
    assert json.loads(target.read_text(encoding="utf-8")) == comments[1:]
    assert len(comments) == 2
