"""Synthetic compatibility checks for preview state and deferred collaborators."""

from __future__ import annotations

import asyncio
import ast
from collections import OrderedDict
from pathlib import Path
from typing import Iterator

import pytest

from backend.api import vault_routes as facade
from backend.domains.vault.pages import cache, preview_routes as previews
from backend.domains.vault.pages.state import PreviewDocument, PreviewPayload, page_state
from backend.services import context_vars


@pytest.fixture(autouse=True)
def isolated_preview_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(page_state, "preview_cache", OrderedDict())
    monkeypatch.setattr(facade, "_preview_inflight", {})
    yield


def test_cache_preserves_payload_identity_and_lru(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cache, "PREVIEW_CACHE_MAX", 2)
    short: dict[str, object] = {"title": [False, None]}
    full: dict[str, object] = {"body_md": "Body"}
    cache.set_cached_preview("a", 1.0, short, full)
    cache.set_cached_preview("b", 1.0, {}, {})
    assert cache.get_cached_preview("a", 2.0, False) is None
    assert list(page_state.preview_cache) == ["a", "b"]
    assert cache.get_cached_preview("a", 1.0, False) is short
    assert cache.get_cached_preview("a", 1.0, True) is full
    cache.set_cached_preview("c", 1.0, {}, {})
    assert list(page_state.preview_cache) == ["a", "c"]
    cache.invalidate_cached_preview("a")
    assert cache.get_cached_preview("a", 1.0, False) is None


def test_index_status_returns_shallow_detached_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(page_state, "indexer_status_by_vault", {})
    nested = [False, None]
    cache.set_indexer_status("synthetic", opaque=nested)
    result = cache.get_indexer_status("synthetic")
    assert result["opaque"] is nested and result["state"] == "idle"
    result["state"] = "changed"
    assert cache.get_indexer_status("synthetic")["state"] == "idle"


@pytest.mark.parametrize("dashboard", [False, True])
def test_compute_preserves_payload_and_parser_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, dashboard: bool
) -> None:
    path = tmp_path / "Synthetic.md"
    path.write_text("raw", encoding="utf-8")
    mtime = path.stat().st_mtime
    events: list[str] = []
    title = [False, None]
    icon = {"opaque": True}
    metadata: dict[object, object] = {"id": 7, "title": title, "icon": icon, "cover": 0}

    async def materialize(file_path: Path, page_id: str) -> None:
        assert file_path == path and page_id == "synthetic"
        events.append("materialize")

    def parse(
        raw: str, file_path: Path, *, render_snapshots: bool = False
    ) -> tuple[dict[object, object], str]:
        assert raw == "raw" and file_path == path
        events.append("full" if render_snapshots else "short")
        return metadata, "![Image](one.png)" if render_snapshots else "Brief"

    def read_dashboard(file_path: Path) -> tuple[dict[object, object], str]:
        assert file_path == path
        events.append("dashboard")
        return metadata, "Dashboard body"

    monkeypatch.setattr(facade, "_materialize_if_online_only", materialize)
    monkeypatch.setattr(facade, "_is_dashboard_file_path", lambda path: dashboard)
    monkeypatch.setattr(facade, "_read_dashboard_file", read_dashboard)
    monkeypatch.setattr(facade, "parse_frontmatter", parse)
    monkeypatch.setattr(facade, "_build_preview_excerpt", lambda body: f"excerpt:{body}")
    short, full, actual_mtime = asyncio.run(previews._compute_preview(path, "synthetic"))
    assert actual_mtime == mtime and short["id"] == "7"
    assert short["title"] is title and full["title"] is title
    assert short["icon"] is icon and short["cover"] == 0
    assert events == (
        ["materialize", "dashboard"] if dashboard else ["materialize", "short", "full"]
    )
    assert full["body_md"] == ("Dashboard body" if dashboard else "![Image](one.png)")
    assert full["images"] == ([] if dashboard else ["one.png"])


@pytest.mark.parametrize("errno,failures", [(35, 2), (35, 9), (13, 1)])
def test_preview_retry_schedule_is_errno_specific(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, errno: int, failures: int
) -> None:
    path = tmp_path / "Synthetic.md"
    path.write_text("raw", encoding="utf-8")
    delays: list[float] = []
    reads = 0
    error = OSError(errno, "synthetic read failure")

    async def materialize(path: Path, page_id: str) -> None:
        return None

    def read_text(file_path: Path, *, encoding: str) -> str:
        nonlocal reads
        assert file_path == path and encoding == "utf-8"
        reads += 1
        if reads <= failures:
            raise error
        return "raw"

    monkeypatch.setattr(facade, "_materialize_if_online_only", materialize)
    monkeypatch.setattr(facade, "_is_dashboard_file_path", lambda path: False)
    monkeypatch.setattr(facade, "parse_frontmatter", lambda *args, **kwargs: ({}, "Body"))
    monkeypatch.setattr(facade, "_build_preview_excerpt", lambda body: body)
    monkeypatch.setattr(Path, "read_text", read_text)
    monkeypatch.setattr(facade.time, "sleep", delays.append)
    if failures == 2:
        assert asyncio.run(previews._compute_preview(path, "synthetic"))[0]["id"] == "synthetic"
    else:
        with pytest.raises(OSError) as raised:
            asyncio.run(previews._compute_preview(path, "synthetic"))
        assert raised.value is error
    assert delays == (
        [0.05, 0.1] if failures == 2 else [0.05, 0.1, 0.2, 0.4, 0.8, 1, 1, 1] if errno == 35 else []
    )
    assert reads == (3 if failures == 2 else 9 if errno == 35 else 1)


@pytest.mark.parametrize("failure", [False, True])
def test_inflight_shares_one_result_or_error_and_cleans_owner(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, failure: bool
) -> None:
    path = tmp_path / "Synthetic.md"
    path.touch()
    events: list[str] = []
    result: PreviewDocument = ({"id": "synthetic"}, {"body_md": "Body"}, 1.0)
    error = OSError(13, "synthetic failure")

    async def scenario() -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        joined = asyncio.Event()
        lookups = 0

        def lookup(page_id: str, mtime: float, *, full: bool) -> None:
            nonlocal lookups
            lookups += 1
            if lookups == 4:
                joined.set()
            return None

        async def compute(file_path: Path, page_id: str) -> PreviewDocument:
            events.append("compute")
            started.set()
            await release.wait()
            if failure:
                raise error
            return result

        def store(page_id: str, mtime: float, short: object, full: object) -> None:
            assert not facade._preview_inflight[page_id].done()
            assert short is result[0] and full is result[1]
            events.append("store")

        monkeypatch.setattr(facade, "_preview_cache_get", lookup)
        monkeypatch.setattr(facade, "_preview_cache_set", store)
        monkeypatch.setattr(previews, "_compute_preview", compute)
        first = asyncio.create_task(previews._fetch_preview_with_cache(path, "synthetic"))
        await asyncio.wait_for(started.wait(), 2)
        second = asyncio.create_task(previews._fetch_preview_with_cache(path, "synthetic"))
        await asyncio.wait_for(joined.wait(), 2)
        release.set()
        responses = await asyncio.gather(first, second, return_exceptions=True)
        if failure:
            assert responses[0] is responses[1] is error
        else:
            assert responses[0] is responses[1]
            assert responses[0] == result
        assert facade._preview_inflight == {}

    asyncio.run(scenario())
    assert events == (["compute"] if failure else ["compute", "store"])


def test_preview_owner_cancellation_keeps_existing_future_behavior(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "Synthetic.md"
    path.touch()

    async def scenario() -> None:
        started = asyncio.Event()

        async def compute(path: Path, page_id: str) -> PreviewDocument:
            started.set()
            return await asyncio.Future[PreviewDocument]()

        monkeypatch.setattr(facade, "_preview_cache_get", lambda *args, **kwargs: None)
        monkeypatch.setattr(previews, "_compute_preview", compute)
        owner = asyncio.create_task(previews._fetch_preview_with_cache(path, "synthetic"))
        await asyncio.wait_for(started.wait(), 2)
        future = facade._preview_inflight["synthetic"]
        owner.cancel()
        with pytest.raises(asyncio.CancelledError):
            await owner
        assert facade._preview_inflight == {}
        assert not future.done()  # Characterize; changing cancellation is a separate behavior fix.
        future.cancel()

    asyncio.run(scenario())


def test_cached_preview_reads_short_then_full(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    path = tmp_path / "Synthetic.md"
    path.touch()
    short: dict[str, object] = {"title": "Synthetic"}
    full: dict[str, object] = {"body_md": "Body"}
    events: list[bool] = []

    def lookup(page_id: str, mtime: float, *, full: bool) -> PreviewPayload:
        events.append(full)
        return (short, full_payload)[full]

    full_payload = full
    monkeypatch.setattr(facade, "_preview_cache_get", lookup)
    result = asyncio.run(previews._fetch_preview_with_cache(path, "synthetic"))
    assert result[0] is short and result[1] is full and events == [False, True]


def test_title_match_precedes_first_alias(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    entries = {
        "alias": {"id": "alias", "title": "Other", "metadata": {"aliases": ["Synthetic"]}},
        "exact": {"id": 7, "title": " Synthetic ", "folder": 0},
    }
    monkeypatch.setattr(facade, "_page_index_entries", {str(tmp_path): entries})
    assert asyncio.run(previews.resolve_by_title("synthetic")) == {
        "id": 7,
        "title": " Synthetic ",
        "folder": 0,
        "matched_alias": None,
    }
    entries.pop("exact")
    result = asyncio.run(previews.resolve_by_title("Synthetic"))
    assert result["id"] == "alias" and result["matched_alias"] == "Synthetic"


def test_title_lookup_preserves_malformed_metadata_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(context_vars, "get_active_vault_path", lambda: tmp_path)
    monkeypatch.setattr(facade, "_page_index_entries", {str(tmp_path): {"a": {"metadata": True}}})
    with pytest.raises(AttributeError, match="get"):
        asyncio.run(previews.resolve_by_title("synthetic"))


def test_image_extraction_preserves_unique_order_and_legacy_limit() -> None:
    body = '![a](one.png) ![b](<two.png>) ![c](one.png) ![d](three.png "Title")'
    assert previews._extract_images_from_body(body) == ["one.png", "two.png", "three.png"]
    assert previews._extract_images_from_body(body, 0) == ["one.png"]


def test_preview_facade_dependencies_have_declared_real_owners() -> None:
    source = Path(previews.__file__).read_text()
    assert "_LegacyAny" not in source and "_strict_cast" not in source
    used = {
        node.attr
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "_legacy"
    }
    root = ast.parse(Path(facade.__file__).read_text())
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
