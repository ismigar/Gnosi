"""CLI refactor contracts with private modules and entirely local collaborators."""

from __future__ import annotations

import importlib.util
import json
import socket
import sys
from collections.abc import Callable, Sequence
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import TYPE_CHECKING

import httpx
import pytest

if TYPE_CHECKING:
    from pipeline.skills.notion_clone.scripts.backfill_notion_views import VaultPage


ROOT = Path(__file__).resolve().parents[2]
BACKFILL_SOURCE = ROOT / "pipeline/skills/notion_clone/scripts/backfill_notion_views.py"
REWALK_SOURCE = ROOT / "pipeline/utils/rewalk_subpage_parents.py"
ANCHOR = "11111111-1111-5111-8111-111111111111"
TAB = "22222222-2222-5222-8222-222222222222"
CHART = "33333333-3333-5333-8333-333333333333"


class _BackfillModule(ModuleType):
    main: Callable[[], int]


class _RewalkModule(ModuleType):
    main: Callable[[Sequence[str] | None], int]
    clone_page_id: Callable[[str], str]


def _forbidden(*args: object, **kwargs: object) -> None:
    raise AssertionError("CLI structure tests must not access real providers or credentials")


def _stub(patch: pytest.MonkeyPatch, name: str, **members: object) -> ModuleType:
    module = ModuleType(name)
    for key, value in members.items():
        setattr(module, key, value)
    patch.setitem(sys.modules, name, module)
    return module


def _load(path: Path, module: ModuleType, patch: pytest.MonkeyPatch) -> None:
    spec = importlib.util.spec_from_file_location(module.__name__, path)
    assert spec is not None and spec.loader is not None
    module.__file__ = str(path)
    patch.setitem(sys.modules, module.__name__, module)
    spec.loader.exec_module(module)


@pytest.fixture(autouse=True)
def offline_imports(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket.socket, "connect", _forbidden)
    monkeypatch.setattr(socket, "create_connection", _forbidden)
    monkeypatch.setattr(sys, "path", list(sys.path))
    for name in ("backend", "backend.config", "backend.domains", "backend.services"):
        _stub(monkeypatch, name)
    _stub(
        monkeypatch, "backend.services.integration_manager",
        integration_manager=SimpleNamespace(get_raw=_forbidden),
    )
    _stub(monkeypatch, "backend.services.notion_importer", NotionClient=_forbidden)


class _HTTPDouble:
    def __init__(self, events: list[object]) -> None:
        self.events = events
        self.tables: object = []
        self.outcomes: list[int | Exception] = []

    def get(self, url: str, **kwargs: object) -> httpx.Response:
        self.events.append(("GET", url, kwargs))
        return httpx.Response(
            200, content=json.dumps(self.tables), request=httpx.Request("GET", url)
        )

    def _write(self, method: str, url: str, kwargs: dict[str, object]) -> httpx.Response:
        self.events.append((method, url, kwargs))
        outcome = self.outcomes.pop(0) if self.outcomes else 200
        if isinstance(outcome, Exception):
            raise outcome
        return httpx.Response(
            outcome, text="local response", request=httpx.Request(method, url)
        )

    def post(self, url: str, **kwargs: object) -> httpx.Response:
        return self._write("POST", url, kwargs)

    def delete(self, url: str, **kwargs: object) -> httpx.Response:
        return self._write("DELETE", url, kwargs)

    def patch(self, url: str, **kwargs: object) -> httpx.Response:
        return self._write("PATCH", url, kwargs)


class _BackfillHarness:
    def __init__(
        self, root: Path, patch: pytest.MonkeyPatch, source: Path = BACKFILL_SOURCE,
    ) -> None:
        self.root = root
        self.patch = patch
        self.events: list[object] = []
        self.api = _HTTPDouble(self.events)
        self.page = root / "page.md"
        self.page.write_text("---\nid: page\n---\nBody\n", encoding="utf-8")
        self.state = root / "resume.jsonl"
        self.pages: list[VaultPage] = [{
            "path": self.page, "rel": "page.md", "id": "page", "title": "Page",
            "table_id": "table", "embeds": [],
        }]
        self.mapping = {"page": "host-id"}
        self.blocks = ["block"]
        self.fetch_results: dict[str, list[str | Exception]] = {}
        self.health = (True, "local")
        self.bad_block = ""
        self.views: list[dict[str, object]] = [
            {"id": ANCHOR, "name": "Anchor", "tabs": [TAB], "plugin": [None, False]},
            {"id": TAB, "name": "Tab"},
        ]
        self.module = _BackfillModule("_backfill_structure_test")
        patch.setenv("GNOSI_DATA_DIR", str(root))
        _stub(patch, "backend.config.data_dir", resolve_data_dir=lambda: root)
        _stub(patch, "backend.domains.notion", view_recreator=SimpleNamespace(
            _strip_icon=lambda value: value,
            view_embed=lambda value: f'<!-- gnosi-view:def {{"view_id":"{value}"}} -->',
        ))
        _stub(patch, "backend.services.notion_mcp",
              healthcheck=lambda: self.health, fetch=self.fetch)
        _stub(patch, "backend.services.notion_mcp_md", extract_db_ids=lambda md: self.blocks)
        _stub(patch, "backend.services.notion_clone",
              build_clone_views=self.build_views, clone_page_id=_forbidden)
        _load(source, self.module, patch)
        patch.setattr(self.module, "httpx", self.api)
        patch.setattr(self.module, "time", SimpleNamespace(sleep=self.pause))
        patch.setattr(self.module, "_auth_headers", lambda: {"Authorization": "Bearer local"})
        patch.setattr(self.module, "scan_vault", lambda *_args: self.pages.copy())
        patch.setattr(self.module, "build_notion_map", lambda *_args: self.mapping)

    def fetch(self, identifier: str) -> str:
        self.events.append(("fetch", identifier))
        choices = self.fetch_results.get(identifier, [])
        value = choices.pop(0) if choices else "local markdown"
        if isinstance(value, Exception):
            raise value
        return value

    def pause(self, seconds: float) -> None:
        self.events.append(("sleep", seconds))

    def build_views(
        self, host: str, table: str, bid: str, markdown: str,
        resolve: Callable[[str], dict[str, object] | None],
        skip_types: tuple[str, ...] = ("chart",),
    ) -> list[dict[str, object]]:
        self.events.append(("build", host, table, bid, markdown, skip_types, resolve("Tasks")))
        if bid == self.bad_block:
            return [{"id": None}]
        return self.views if skip_types else [
            *self.views, {"id": CHART, "name": "Chart"},
        ]

    def run(self, *options: str) -> tuple[int, str]:
        self.patch.setattr(sys, "argv", [
            "backfill", "--vault-dir", str(self.root), "--vault-id", "local-vault",
            "--api", "https://local.invalid/api/", "--state", str(self.state), *options,
        ])
        output = StringIO()
        with redirect_stdout(output):
            code = self.module.main()
        return code, output.getvalue()

    def writes(self) -> list[object]:
        return [event for event in self.events if isinstance(event, tuple)
                and event[0] in {"POST", "DELETE", "PATCH"}]


@pytest.fixture
def backfill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> _BackfillHarness:
    return _BackfillHarness(tmp_path, monkeypatch)


@pytest.mark.parametrize("apply", [False, True])
def test_backfill_retry_request_and_resume_bytes(backfill: _BackfillHarness, apply: bool) -> None:
    backfill.fetch_results["host-id"] = ["", "", "page"]
    backfill.api.outcomes = [200, 200, 404, 200]
    code, output = backfill.run(*(["--apply"] if apply else []))
    assert code == 0
    assert backfill.events[1:7] == [
        ("fetch", "host-id"), ("sleep", 2), ("fetch", "host-id"),
        ("sleep", 4), ("fetch", "host-id"), ("fetch", "block"),
    ]
    assert output.endswith(
        '\n=== SUMMARY ===\n{"pages": 1, "views_upserted": 2, "embeds_added": 1, '
        '"unmapped": 0, "mcp_empty": 0}\n'
    )
    assert backfill.page.read_bytes() == b"---\nid: page\n---\nBody\n"
    if not apply:
        assert backfill.writes() == [] and not backfill.state.exists()
        return
    headers = {"X-Vault-Id": "local-vault", "Authorization": "Bearer local"}
    assert backfill.writes() == [
        ("POST", "https://local.invalid/api/vault/views",
         {"headers": headers, "json": view, "timeout": 60}) for view in backfill.views
    ] + [
        ("DELETE", f"https://local.invalid/api/vault/views/{CHART}",
         {"headers": headers, "timeout": 60}),
        ("PATCH", "https://local.invalid/api/vault/pages/page", {
            "headers": headers,
            "json": {"content": f'Body\n\n<!-- gnosi-view:def {{"view_id":"{ANCHOR}"}} -->\n'},
            "timeout": 120,
        }),
    ]
    assert backfill.state.read_bytes() == b'{"id": "page", "rel": "page.md", "added": 1}\n'
    backfill.events.clear()
    assert backfill.run("--apply")[0] == 0
    assert len(backfill.events) == 1  # Tables still load, but the completed page is skipped.


@pytest.mark.parametrize("failure", ["empty", "unmapped", "read", "frontmatter", "block"])
def test_backfill_failed_page_never_writes_or_resumes(
    backfill: _BackfillHarness, failure: str,
) -> None:
    if failure == "empty":
        backfill.fetch_results["host-id"] = ["", "", ""]
    elif failure == "unmapped":
        backfill.mapping.clear()
    elif failure == "read":
        backfill.pages[0]["path"] = backfill.root / "missing.md"
    elif failure == "frontmatter":
        backfill.page.write_text("---\nid: page", encoding="utf-8")
    else:
        backfill.blocks = ["block", "bad-block", "later-block"]
        backfill.bad_block = "bad-block"
    code, output = backfill.run("--apply")
    assert code == 0
    assert '"pages": 0, "views_upserted": 0' in output
    assert not backfill.state.exists() and backfill.writes() == []
    if failure == "block":
        assert ("fetch", "later-block") in backfill.events
        assert "Clone view ID must be a nonempty string" in output


@pytest.mark.parametrize("phase", ["fetch", "post", "delete", "patch"])
def test_backfill_transport_failure_propagates_without_resume(
    backfill: _BackfillHarness, phase: str,
) -> None:
    failure = RuntimeError("local transport failure")
    if phase == "fetch":
        backfill.fetch_results["host-id"] = [failure]
    else:
        backfill.api.outcomes = [200] * {"post": 0, "delete": 2, "patch": 3}[phase] + [failure]
    with pytest.raises(RuntimeError) as caught:
        backfill.run("--apply")
    assert caught.value is failure
    assert not backfill.state.exists()
    assert ("sleep", 2) not in backfill.events


def test_backfill_healthcheck_precedes_invalid_resume(backfill: _BackfillHarness) -> None:
    backfill.health = (False, "local offline")
    backfill.state.write_text("not JSON", encoding="utf-8")
    assert backfill.run("--apply") == (1, "Notion MCP is unavailable: local offline\n")
    assert backfill.events == []


@pytest.mark.parametrize("record, message", [
    ([], "Resume record must be an object"),
    ({}, "Resume page ID must be a nonempty string"),
    ({"id": 7}, "Resume page ID must be a nonempty string"),
])
def test_backfill_resume_error_text_and_order(
    backfill: _BackfillHarness, record: object, message: str,
) -> None:
    content = "\n " + json.dumps(record) + "\n"
    backfill.state.write_text(content, encoding="utf-8")
    with pytest.raises(ValueError) as caught:
        backfill.run("--apply")
    assert str(caught.value) == message
    assert backfill.events == []
    assert backfill.state.read_text() == content


def test_backfill_all_payloads_serialize_before_first_write(backfill: _BackfillHarness) -> None:
    backfill.views[-1]["opaque"] = object()
    with pytest.raises(TypeError, match="not JSON serializable"):
        backfill.run("--apply")
    assert backfill.writes() == [] and not backfill.state.exists()


class _RewalkHarness:
    def __init__(
        self, patch: pytest.MonkeyPatch, source: Path = REWALK_SOURCE,
    ) -> None:
        self.events: list[object] = []
        self.api = _HTTPDouble(self.events)
        self.pages: list[dict[str, object]] = []
        self.blocks: dict[str, dict[str, object] | Exception] = {}
        self.client = SimpleNamespace(search_pages=lambda: self.pages, get_block=self.get_block)
        self.module = _RewalkModule("_rewalk_structure_test")
        _load(source, self.module, patch)
        _stub(patch, "backend.services.integration_manager", integration_manager=SimpleNamespace(
            get_raw=lambda name: {"token": "local"},
        ))
        _stub(patch, "backend.services.notion_importer", NotionClient=lambda token: self.client)
        patch.setattr(self.module, "httpx", self.api)
        patch.setattr(self.module, "time", SimpleNamespace(sleep=lambda t: self.events.append(("sleep", t))))
        patch.setattr(self.module, "_auth_headers", lambda: {})

    def get_block(self, identifier: str) -> dict[str, object]:
        self.events.append(("block", identifier))
        value = self.blocks[identifier]
        if isinstance(value, Exception):
            raise value
        return value

    def vault(self, names: Sequence[str]) -> None:
        self.api.tables = [{"id": self.module.clone_page_id(name), "title": name} for name in names]

    def run(self, *options: str) -> tuple[int, str]:
        output = StringIO()
        with redirect_stdout(output):
            code = self.module.main(["--vault-id", "local-vault", *options])
        return code, output.getvalue()


@pytest.fixture
def rewalk(monkeypatch: pytest.MonkeyPatch) -> _RewalkHarness:
    return _RewalkHarness(monkeypatch)


def test_rewalk_block_reader_is_late_bound_and_cache_is_per_run(rewalk: _RewalkHarness) -> None:
    rewalk.pages = [{"id": name, "parent": {"type": "block_id", "block_id": "inner"}}
                    for name in ("one", "two")]
    rewalk.vault(["one", "two", "parent"])

    def outer(identifier: str) -> dict[str, object]:
        assert identifier == "outer"
        rewalk.events.append(("replacement", identifier))
        return {"parent": {"type": "page_id", "page_id": "parent"}}

    def inner(identifier: str) -> dict[str, object]:
        assert identifier == "inner"
        rewalk.events.append(("original", identifier))
        rewalk.client.get_block = outer
        return {"parent": {"type": "block_id", "block_id": "outer"}}

    for _ in range(2):
        rewalk.client.get_block = inner
        rewalk.events.clear()
        code, output = rewalk.run()
        assert code == 0 and "to repair: 2" in output
        assert rewalk.events[:2] == [("original", "inner"), ("replacement", "outer")]
        assert len(rewalk.events) == 3


def test_rewalk_failed_blocks_are_retried_not_cached(rewalk: _RewalkHarness) -> None:
    rewalk.pages = [{"id": name, "parent": {"type": "block_id", "block_id": "bad"}}
                    for name in ("one", "two")]
    rewalk.blocks["bad"] = RuntimeError("local block failure")
    rewalk.vault(["one", "two"])
    code, output = rewalk.run()
    assert code == 0
    assert rewalk.events[:2] == [("block", "bad"), ("block", "bad")]
    assert output.count("! could not resolve block bad: local block failure") == 2


@pytest.mark.parametrize("parent, error, message", [
    ({"type": "page_id"}, KeyError, "'page_id'"),
    ({"type": "page_id", "page_id": 3}, TypeError,
     "Notion/vault identifiers and tokens must be strings"),
    (True, TypeError, "Notion/vault page data must be a mapping"),
])
def test_rewalk_malformed_parents_fail_before_vault_request(
    rewalk: _RewalkHarness, parent: object, error: type[Exception], message: str,
) -> None:
    rewalk.pages = [{"id": "child", "parent": parent}]
    with pytest.raises(error) as caught:
        rewalk.run("--apply")
    assert str(caught.value) == message and rewalk.events == []


def test_rewalk_progress_failure_order_and_exact_output(rewalk: _RewalkHarness) -> None:
    names = [f"child-{i}" for i in range(26)]
    rewalk.pages = [{"id": name, "parent": {"type": "page_id", "page_id": "parent"}}
                    for name in names]
    rewalk.vault([*names, "parent"])
    rewalk.api.outcomes = [503, RuntimeError("local patch failure")]
    code, output = rewalk.run("--apply")
    assert code == 1
    expected = (
        "1) Searching for pages in Notion...\n   26 pages\n"
        "2) Resolving child → parent pairs...\n   26 pages with a parent page in Notion\n"
        "3) Reading the clone vault...\n   27 pages in the clone vault\n"
        "4) Calculating PATCH requests...\n"
        "   to repair: 26 | already correct: 0 | child not cloned: 0 | parent not cloned: 0\n"
    )
    expected += "".join(f"   · '{name}' → will be attached to 'parent'\n" for name in names[:15])
    expected += (
        "   … and 11 more\n5) Applying PATCH requests sequentially...\n"
        "   ! 503 «child-0»: local response\n"
        "   ! exception for 'child-1': local patch failure\n   ...25/26\n"
        "\nDONE: 24 repaired, 2 errors, 0 already correct.\n"
    )
    assert output.encode() == expected.encode()
    assert rewalk.events[2::2] == [("sleep", 0.05)] * 26
    assert len(rewalk.events) == 53


def test_cli_required_arguments_do_not_call_collaborators(
    rewalk: _RewalkHarness, backfill: _BackfillHarness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "argv", ["backfill"])
    for main in (backfill.module.main, lambda: rewalk.module.main([])):
        with pytest.raises(SystemExit) as caught:
            main()
        assert caught.value.code == 2
    assert rewalk.events == backfill.events == []
