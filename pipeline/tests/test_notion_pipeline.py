"""Offline Notion CLI contracts, collected in a clean validation subprocess.

Only the wrapper runs in the global suite. Backend imports and synthetic CLI
execution occur after the child has configured every disposable data selector.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Iterable, Mapping
from copy import deepcopy
from datetime import date
from pathlib import Path
from types import ModuleType

import httpx
import pytest
import yaml


def test_notion_pipeline_in_isolated_subprocess(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GNOSI_VALIDATION_ROOT", raising=False)
    if "backend.config.paths_config" not in sys.modules:
        monkeypatch.setitem(
            sys.modules, "backend.config.paths_config", ModuleType("backend.config.paths_config")
        )
    with tempfile.TemporaryDirectory(prefix="gnosi-notion-pipeline-") as temporary:
        root = Path(temporary).resolve()
        for name in ("data", "vault", "host"):
            (root / name).mkdir()
        environment = {
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "GNOSI_VALIDATION_ROOT": str(root),
            "GNOSI_DATA_DIR": str(root / "data"),
            "DIGITAL_BRAIN_VAULT_PATH": str(root / "vault"),
            "VAULT_HOST_PATH": str(root / "vault"),
            "HOME_HOST_PATH": str(root / "host"),
            "GNOSI_SHARED_ENV_FILE": str(root / "disabled.env"),
            "GNOSI_DISABLE_SCHEDULER": "1",
            "GNOSI_FILES_PROVIDER": "local",
            "GNOSI_RUN_LIVE_E2E": "0",
        }
        result = subprocess.run(
            [
                sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                "-o", "python_functions=test_* check_*",
                "-k", "not test_notion_pipeline_in_isolated_subprocess",
                "pipeline/tests/test_notion_pipeline.py",
                "backend/tests/test_cleanup_notion_views.py",
                "backend/tests/test_notion_clone.py",
                "backend/tests/test_notion_clone_verify.py",
                "backend/tests/test_notion_view_recreator.py",
            ],
            cwd=Path(__file__).resolve().parents[2], env=environment,
            capture_output=True, text=True, timeout=180, check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        sys.stdout.write(result.stdout)


@pytest.fixture
def isolated_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.config.validation_runtime import validation_runtime_enabled

    assert validation_runtime_enabled()

    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("A synthetic Notion check attempted real network access")

    monkeypatch.setattr(socket.socket, "connect", forbidden)


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _view(view_id: str, **fields: object) -> dict[str, object]:
    return {
        "id": view_id, "name": "Shared", "table_id": "t", "type": "table",
        "embedded": True, "source_view_id": "source", **fields,
    }


@pytest.mark.usefixtures("isolated_runtime")
def check_cleanup_keeps_order_metadata_tabs_and_input_immutable() -> None:
    from pipeline.skills.notion_clone.scripts.cleanup_notion_views import compact_registry

    opaque = {"plugin": [None, {"custom": [7, False]}]}
    views: list[dict[str, object]] = [
        _view("first", tabs=["tab-one"], extensions=opaque),
        {"id": "other-table", "table_id": "other", "tabs": ["second"], "custom": opaque},
        _view("second", tabs=["tab-two", "first"], extensions=opaque),
        _view("tab-one", source_view_id="one", tabs=["tab-two"]),
        _view("tab-two", source_view_id="two", tabs=["tab-one"]),
        _view("orphan", source_view_id="orphan"),
        {"id": "user", "table_id": "t", "config": ["opaque"], "filters": {"plugin": 8}},
    ]
    registry: dict[str, object] = {"views": views, "extensions": opaque, "version": 9}
    original = deepcopy(registry)
    compacted, aliases, orphans = compact_registry(registry, "t", True, {"other-table"})
    assert registry == original
    assert aliases == {"second": "first"}
    assert orphans == ["orphan"]
    assert compacted == {
        **registry,
        "views": [
            {**views[0], "tabs": ["tab-one", "tab-two"]},
            {**views[1], "tabs": ["first"]}, views[3], views[4], views[6],
        ],
    }
    assert compact_registry(compacted, "t", True, {"other-table"}) == (compacted, {}, [])


@pytest.mark.parametrize("bad", [None, {}, [None], [{"id": 7}], [{"id": ""}],
                                      [{"id": "v", "tabs": "v"}],
                                      [{"id": "v", "tabs": [None]}],
                                      [{"id": "v"}, {"id": "v"}],
                                      [_view("v", filters={"field": "x"})]])
@pytest.mark.usefixtures("isolated_runtime")
def check_cleanup_rejects_malformed_registry_before_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bad: object,
) -> None:
    from pipeline.skills.notion_clone.scripts import cleanup_notion_views as cleanup

    registry = tmp_path / "BD" / "vault_db_registry.json"
    raw = json.dumps({"views": bad, "opaque": {"unchanged": True}})
    _write(registry, raw)
    _write(tmp_path / "page.md", "Body unchanged")
    monkeypatch.setattr(sys, "argv", ["cleanup", "--vault-dir", str(tmp_path), "--apply"])
    with pytest.raises(ValueError):
        cleanup.main()
    assert registry.read_text() == raw
    assert (tmp_path / "page.md").read_text() == "Body unchanged"
    assert list(registry.parent.glob("*.bak-*.json")) == []


@pytest.mark.usefixtures("isolated_runtime")
def check_cleanup_conflicting_source_metadata_is_not_discarded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pipeline.skills.notion_clone.scripts import cleanup_notion_views as cleanup

    registry = tmp_path / "BD" / "vault_db_registry.json"
    raw = json.dumps({"views": [_view("one", plugin={"v": 1}), _view("two", plugin={"v": 2})]})
    _write(registry, raw)
    monkeypatch.setattr(sys, "argv", ["cleanup", "--vault-dir", str(tmp_path), "--apply"])
    with pytest.raises(ValueError, match="Conflicting duplicate"):
        cleanup.main()
    assert registry.read_text() == raw
    assert list(registry.parent.glob("*.bak-*.json")) == []


@pytest.mark.usefixtures("isolated_runtime")
def check_cleanup_cli_dry_run_apply_backup_and_idempotence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pipeline.skills.notion_clone.scripts import cleanup_notion_views as cleanup

    one, two = "11111111-1111-5111-8111-111111111111", "22222222-2222-5222-8222-222222222222"
    registry = tmp_path / "BD" / "vault_db_registry.json"
    raw = json.dumps({"views": [_view(one), _view(two)], "opaque": [None, 4]})
    _write(registry, raw)
    original = f'Before\n<!-- gnosi-view:def {{"view_id":"{two}"}} -->\nAfter\n'
    _write(tmp_path / "page.md", original)
    _write(tmp_path / ".history" / "old.md", original)
    argv = ["cleanup", "--vault-dir", str(tmp_path)]
    monkeypatch.setattr(sys, "argv", argv)
    assert cleanup.main() == 0
    assert registry.read_text() == raw
    assert (tmp_path / "page.md").read_text() == original
    assert list(registry.parent.glob("*.bak-*.json")) == []
    monkeypatch.setattr(sys, "argv", [*argv, "--apply"])
    assert cleanup.main() == 0
    backups = list(registry.parent.glob("*.bak-*.json"))
    assert len(backups) == 1 and backups[0].read_text() == raw
    assert (tmp_path / "page.md").read_text() == original.replace(two, one)
    assert (tmp_path / ".history" / "old.md").read_text() == original
    compacted = registry.read_bytes()
    assert cleanup.main() == 0
    assert registry.read_bytes() == compacted
    assert list(registry.parent.glob("*.bak-*.json")) == backups


HOST = "11111111111111111111111111111111"
BLOCK = "22222222222222222222222222222222"
SECOND_BLOCK = "33333333333333333333333333333333"
VIEW_MD = (
    'The title of this Data Source is: 📀 Tasks\n<views>\n'
    '<view url="{{view://one}}">{"name":"Table","type":"table",'
    '"displayProperties":["Name","Status"]}</view>\n'
    '<view url="{{view://two}}">{"name":"Board","type":"board",'
    '"displayProperties":["Name"],"groupBy":{"property":"Status"}}</view>\n'
    '<view url="{{view://chart}}">{"name":"Suggested","type":"chart"}</view>\n'
    '</views>'
)


class _RestClient:
    def __init__(self, token: str = "synthetic") -> None:
        assert token == "synthetic"
        self.rows: list[dict[str, object]] = []
        self.search: list[dict[str, object]] = []
        self.queried: list[str] = []
        self.searches = 0

    def query_database(self, database_id: str) -> Iterable[Mapping[str, object]]:
        self.queried.append(database_id)
        yield from self.rows

    def search_pages(self) -> list[dict[str, object]]:
        self.searches += 1
        return self.search

    def list_users(self) -> dict[str, str]:
        return {"person-id": "Person"}


class _Backfill:
    def __init__(self, root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        from backend.domains.notion import view_recreator as nvr
        from backend.services import notion_mcp
        from backend.services.integration_manager import integration_manager
        from backend.services.notion_clone import build_clone_views, clone_page_id
        from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill

        self.root = root
        self.page = root / ".Dashboards" / "page.md"
        self.state = root / "state.jsonl"
        self.writes: list[tuple[str, str, object]] = []
        self.fetches: list[str] = []
        self.status = 200
        self.page_md = f'<database url="https://notion.test/{BLOCK}" inline="true"></database>'
        self.view_md = VIEW_MD
        self.table: dict[str, object] = {
            "id": "tasks-table", "name": "Tasks",
            "properties": [{"name": "Name", "type": "title"}, {"name": "Status", "type": "status"}],
            "opaque": {"config": [None, 4]},
        }
        self.views = build_clone_views(HOST, "", BLOCK, VIEW_MD, lambda name: self.table)
        self.all_views = build_clone_views(
            HOST, "", BLOCK, VIEW_MD, lambda name: self.table, skip_types=()
        )
        self.page_id = clone_page_id(HOST)
        self.original = (
            f'---\nid: {self.page_id}\ntitle: Dashboard\ncustom: [null, 7]\n---\n'
            'User body\n\n' + '\n\n'.join(
                nvr.view_embed(str(view["id"])) for view in self.all_views
            ) + '\n\nUser ending\n'
        )
        _write(self.page, self.original)
        monkeypatch.setattr(notion_mcp, "healthcheck", lambda: (True, "synthetic"))
        monkeypatch.setattr(notion_mcp, "fetch", self.fetch)
        monkeypatch.setattr(time, "sleep", lambda seconds: None)
        monkeypatch.setattr(integration_manager, "get_raw", lambda name: {"token": "synthetic"})
        monkeypatch.setattr(backfill, "NotionClient", _RestClient)
        monkeypatch.setattr(httpx, "get", self.get)
        monkeypatch.setattr(httpx, "post", self.post)
        monkeypatch.setattr(httpx, "delete", self.delete)
        monkeypatch.setattr(httpx, "patch", self.patch)
        monkeypatch.setenv("GNOSI_API_TOKEN", "synthetic-api")

    def fetch(self, page_id: str) -> str:
        self.fetches.append(page_id)
        return self.page_md if page_id == HOST else self.view_md

    def get(self, url: str, **kwargs: object) -> httpx.Response:
        assert kwargs["headers"] == {"X-Vault-Id": "synthetic-vault", "Authorization": "Bearer synthetic-api"}
        if url.endswith("/vault/tables"):
            payload: object = {"tables": [self.table]}
        else:
            assert url.endswith("/notion/import-config")
            payload = {"config": {"loosePageTypes": {HOST: "Page"}, "databases": []}}
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))

    def _write_request(self, method: str, url: str, kwargs: Mapping[str, object]) -> httpx.Response:
        payload = kwargs.get("json")
        self.writes.append((method, url, deepcopy(payload)))
        return httpx.Response(self.status, json={}, request=httpx.Request(method, url))

    def post(self, url: str, **kwargs: object) -> httpx.Response:
        return self._write_request("POST", url, kwargs)

    def delete(self, url: str, **kwargs: object) -> httpx.Response:
        return self._write_request("DELETE", url, kwargs)

    def patch(self, url: str, **kwargs: object) -> httpx.Response:
        return self._write_request("PATCH", url, kwargs)

    def run(self, monkeypatch: pytest.MonkeyPatch, *options: str) -> int:
        from pipeline.skills.notion_clone.scripts.backfill_notion_views import main

        monkeypatch.setattr(sys, "argv", [
            "backfill", "--vault-dir", str(self.root), "--vault-id", "synthetic-vault",
            "--state", str(self.state), *options,
        ])
        return main()


@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_real_tabs_payload_order_dry_run_apply_and_resume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill

    fixture = _Backfill(tmp_path, monkeypatch)
    assert len(fixture.views) == 2 and len(fixture.all_views) == 3
    assert fixture.run(monkeypatch) == 0
    assert fixture.writes == [] and not fixture.state.exists()
    assert fixture.page.read_text() == fixture.original
    assert fixture.run(monkeypatch, "--apply") == 0
    assert [method for method, _, _ in fixture.writes] == ["POST", "POST", "DELETE", "PATCH"]
    assert [payload for method, _, payload in fixture.writes if method == "POST"] == fixture.views
    assert fixture.writes[2][1].endswith(str(fixture.all_views[-1]["id"]))
    patch = fixture.writes[-1][2]
    assert isinstance(patch, dict)
    content = patch["content"]
    assert isinstance(content, str)
    assert backfill.EMBED_RE.findall(content) == [fixture.views[0]["id"]]
    assert "User body" in content and "User ending" in content
    assert fixture.views[0]["tabs"] == [fixture.views[1]["id"]]
    assert json.loads(fixture.state.read_text()) == {
        "id": fixture.page_id, "rel": ".Dashboards/page.md", "added": 1,
    }
    writes, fetches, state = deepcopy(fixture.writes), list(fixture.fetches), fixture.state.read_bytes()
    assert fixture.run(monkeypatch, "--apply") == 0
    assert fixture.writes == writes and fixture.fetches == fetches
    assert fixture.state.read_bytes() == state


@pytest.mark.parametrize("bad", [None, 42, "", [], {}, {"id": ""}, {"id": ["bad"]}])
@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_resume_validation_precedes_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, bad: object,
) -> None:
    fixture = _Backfill(tmp_path, monkeypatch)
    raw = json.dumps(bad) + "\n"
    _write(fixture.state, raw)
    with pytest.raises(ValueError):
        fixture.run(monkeypatch, "--apply")
    assert fixture.state.read_text() == raw
    assert fixture.writes == []


@pytest.mark.parametrize("failure", ["empty", "bad-id", "bad-tabs", "nonserializable"])
@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_validates_all_blocks_before_any_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str,
) -> None:
    from backend.services import notion_mcp
    from backend.services.notion_clone import build_clone_views
    from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill

    fixture = _Backfill(tmp_path, monkeypatch)
    fixture.page_md += f'\n<database url="https://notion.test/{SECOND_BLOCK}" inline="true"></database>'

    def build_views(
        host: str, table_id: str, bid: str, view_md: str,
        resolve: Callable[[str], dict[str, object] | None], skip_types: tuple[str, ...] = ("chart",),
    ) -> list[dict[str, object]]:
        views: list[dict[str, object]] = build_clone_views(host, table_id, bid, view_md, resolve, skip_types)
        if bid == SECOND_BLOCK:
            if failure == "bad-id":
                views[-1]["id"] = None
            elif failure == "bad-tabs":
                views[0]["tabs"] = "not-a-list"
            elif failure == "nonserializable":
                views[0]["opaque"] = object()
        return views

    monkeypatch.setattr(backfill, "build_clone_views", build_views)
    if failure == "empty":
        monkeypatch.setattr(notion_mcp, "fetch", lambda pid: "" if pid == SECOND_BLOCK else fixture.fetch(pid))
    if failure == "nonserializable":
        with pytest.raises(TypeError):
            fixture.run(monkeypatch, "--apply")
    else:
        assert fixture.run(monkeypatch, "--apply") == 0
    assert fixture.writes == [] and not fixture.state.exists()
    assert fixture.page.read_text() == fixture.original


@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_failed_http_does_not_record_resume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = _Backfill(tmp_path, monkeypatch)
    fixture.status = 500
    with pytest.raises(httpx.HTTPStatusError):
        fixture.run(monkeypatch, "--apply")
    assert not fixture.state.exists()
    assert fixture.page.read_text() == fixture.original


@pytest.mark.usefixtures("isolated_runtime")
def check_frontmatter_retains_yaml_keys_dates_and_opaque_fields(tmp_path: Path) -> None:
    from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill
    from pipeline.skills.notion_clone.scripts import verify_notion_table_exact as verify

    raw = "---\nid: row\n7: opaque\ncreated: 2024-01-02\ncustom: [null, {k: false}]\n---\nBody\n"
    page = tmp_path / "page.md"
    _write(page, raw)
    expected: dict[object, object] = {
        "id": "row", 7: "opaque", "created": date(2024, 1, 2), "custom": [None, {"k": False}],
    }
    assert backfill.parse_frontmatter(raw) == (expected, "Body\n")
    assert verify._frontmatter(page) == expected


@pytest.mark.parametrize("raw", ["---\n[one, two]\n---\nBody", "---\nx: [broken\n---\nBody"])
@pytest.mark.usefixtures("isolated_runtime")
def check_malformed_frontmatter_is_not_silently_dropped(tmp_path: Path, raw: str) -> None:
    from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill
    from pipeline.skills.notion_clone.scripts import verify_notion_table_exact as verify

    page = tmp_path / "page.md"
    _write(page, raw)
    with pytest.raises((ValueError, yaml.YAMLError)):
        backfill.parse_frontmatter(raw)
    with pytest.raises((ValueError, yaml.YAMLError)):
        verify._frontmatter(page)
    assert page.read_text() == raw


@pytest.mark.usefixtures("isolated_runtime")
def check_expected_rows_real_ids_order_and_structured_values() -> None:
    from backend.services.notion_clone import clone_page_id
    from pipeline.skills.notion_clone.scripts import verify_notion_table_exact as verify

    client = _RestClient()
    client.rows = [{"id": "row-one", "properties": {
        "Name": {"type": "title", "title": [{"plain_text": "Title"}]},
        "Links": {"type": "relation", "relation": [{"id": "row-two"}]},
        "Tags": {"type": "multi_select", "multi_select": [{"name": "B"}, {"name": "A"}]},
        "Done": {"type": "checkbox", "checkbox": False},
        "Score": {"type": "number", "number": 0},
        "Date": {"type": "date", "date": {"start": "2024-01-01", "end": "2024-01-02"}},
    }}]
    table: dict[str, object] = {"id": "table", "properties": [
        {"name": name, "type": kind} for name, kind in (
            ("Name", "title"), ("Links", "relation"), ("Tags", "multi_select"),
            ("Done", "checkbox"), ("Score", "number"), ("Date", "date"),
        )
    ]}
    original = deepcopy(client.rows)
    rows = verify._expected_rows(client, "database", table)
    assert rows == {clone_page_id("row-one"): {
        "id": clone_page_id("row-one"), "title": "Title", "table_id": "table",
        "Name": "Title", "Links": [clone_page_id("row-two")], "Tags": ["B", "A"],
        "Done": False, "Score": 0, "Date": {"start": "2024-01-01", "end": "2024-01-02"},
    }}
    assert client.rows == original


@pytest.mark.parametrize("bad", [None, "", 7, [], {}])
@pytest.mark.usefixtures("isolated_runtime")
def check_expected_rows_rejects_invalid_ids(bad: object) -> None:
    from pipeline.skills.notion_clone.scripts import verify_notion_table_exact as verify

    client = _RestClient()
    client.rows = [{"id": bad, "properties": {}}]
    with pytest.raises(ValueError, match="Notion row ID"):
        verify._expected_rows(client, "database", {"properties": []})


@pytest.mark.usefixtures("isolated_runtime")
def check_duplicate_clone_rows_cannot_hide_data(tmp_path: Path) -> None:
    from pipeline.skills.notion_clone.scripts import verify_notion_table_exact as verify

    _write(tmp_path / "one.md", "---\nid: same\ntable_id: table\nName: First\n---\nBody")
    _write(tmp_path / "two.md", "---\nid: same\ntable_id: table\nName: Second\n---\nBody")
    with pytest.raises(ValueError, match="Duplicate clone row ID"):
        verify._clone_rows(tmp_path, "table")


@pytest.mark.parametrize("payload", [[], {"config": []}, {"config": {"databases": {}}},
                                     {"config": {"databases": [None]}},
                                     {"config": {"databases": [{"id": None}]}},
                                     {"config": {"loosePageTypes": ["page"]}}])
@pytest.mark.usefixtures("isolated_runtime")
def check_map_rejects_malformed_config(payload: object, monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill

    def get(url: str, **kwargs: object) -> httpx.Response:
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))

    def forbidden(token: str) -> None:
        raise AssertionError("Invalid configuration must be rejected before client creation")

    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(backfill, "NotionClient", forbidden)
    with pytest.raises(ValueError):
        backfill.build_notion_map("https://synthetic.invalid", {}, {"page"})


@pytest.mark.usefixtures("isolated_runtime")
def check_map_preserves_ids_order_and_reports_invalid_row_then_uses_search(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    from backend.services.integration_manager import integration_manager
    from backend.services.notion_clone import clone_page_id
    from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill

    client = _RestClient()
    client.rows = [{"id": "row-one"}, {"id": None}]
    client.search = [{"id": "row-one"}, {"id": "row-two"}]

    def get(url: str, **kwargs: object) -> httpx.Response:
        return httpx.Response(200, json={"config": {
            "loosePageTypes": {"loose-page": {"opaque": 9}},
            "databases": [{"id": "database", "title": "Synthetic"}],
        }}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(backfill, "NotionClient", lambda token: client)
    monkeypatch.setattr(integration_manager, "get_raw", lambda name: {"token": "synthetic"})
    expected = {clone_page_id(raw): raw for raw in ("loose-page", "row-one", "row-two")}
    result = backfill.build_notion_map("https://synthetic.invalid", {}, set(expected))
    assert result == expected and list(result) == list(expected)
    assert client.queried == ["database"] and client.searches == 1
    assert "Notion page ID must be a nonempty string" in capsys.readouterr().out


@pytest.mark.parametrize("tables", [None, {}, [None], [{"name": 9}],
                                    [{"name": "Tasks", "properties": [None]}]])
@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_table_validation_precedes_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, tables: object,
) -> None:
    fixture = _Backfill(tmp_path, monkeypatch)

    def get(url: str, **kwargs: object) -> httpx.Response:
        return httpx.Response(200, json={"tables": tables}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    with pytest.raises(ValueError):
        fixture.run(monkeypatch, "--apply")
    assert fixture.writes == [] and not fixture.state.exists()


@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_preserves_opaque_view_payloads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services.notion_clone import build_clone_views
    from pipeline.skills.notion_clone.scripts import backfill_notion_views as backfill

    fixture = _Backfill(tmp_path, monkeypatch)
    opaque = {"custom": [False, None, {"unknown": "retained"}]}

    def build_views(
        host: str, table_id: str, bid: str, view_md: str,
        resolve: Callable[[str], dict[str, object] | None], skip_types: tuple[str, ...] = ("chart",),
    ) -> list[dict[str, object]]:
        return [{**view, "plugin": opaque} for view in
                build_clone_views(host, table_id, bid, view_md, resolve, skip_types)]

    monkeypatch.setattr(backfill, "build_clone_views", build_views)
    assert fixture.run(monkeypatch, "--apply") == 0
    assert [payload for method, _, payload in fixture.writes if method == "POST"] == [
        {**view, "plugin": opaque} for view in fixture.views
    ]


@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_page_selection_and_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.services import notion_mcp
    from backend.services.notion_clone import clone_page_id

    fixture = _Backfill(tmp_path, monkeypatch)
    for name in ("Wiki/page.md", "Rows/page.md", ".history/ignored.md"):
        _write(tmp_path / name, fixture.original.replace(fixture.page_id, clone_page_id(name)))
    seen: list[str] = []

    def get(url: str, **kwargs: object) -> httpx.Response:
        if url.endswith("/vault/tables"):
            return fixture.get(url, **kwargs)
        return httpx.Response(200, json={"config": {
            "loosePageTypes": {pid: "Page" for pid in (HOST, "Wiki/page.md", "Rows/page.md")},
        }}, request=httpx.Request("GET", url))

    def fetch(page_id: str) -> str:
        seen.append(page_id)
        return "No blocks"

    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(notion_mcp, "fetch", fetch)
    assert fixture.run(monkeypatch) == 0
    assert seen == [HOST, "Wiki/page.md", "Rows/page.md"]
    seen.clear()
    assert fixture.run(monkeypatch, "--only", "Wiki", "--limit", "1") == 0
    assert seen == ["Wiki/page.md"]
    seen.clear()
    assert fixture.run(monkeypatch, "--ids", clone_page_id("Rows/page.md")) == 0
    assert seen == ["Rows/page.md"]
    assert fixture.writes == []


@pytest.mark.usefixtures("isolated_runtime")
def check_backfill_snapshot_removal_is_bounded_and_incomplete_snapshot_refuses_write() -> None:
    from pipeline.skills.notion_clone.scripts.backfill_notion_views import remove_view_defs

    view_id = "11111111-1111-5111-8111-111111111111"
    marker = f'<!-- gnosi-view:def {{"view_id":"{view_id}"}} -->'
    snapshot = f'<!-- gnosi-view:result {{"view_id":"{view_id}"}} -->\nCached\n'
    body = "Before\n" + marker + "\n\n" + snapshot + "<!-- /gnosi-view:result -->\nAfter\n"
    assert remove_view_defs(body, {view_id}) == "Before\nAfter\n"
    prose = "Prose referring to " + marker + " without being an embed"
    assert remove_view_defs(prose, {view_id}) == prose
    with pytest.raises(ValueError, match="Unterminated view snapshot"):
        remove_view_defs("Before\n" + marker + "\n" + snapshot + "User content", {view_id})


class _DatabaseClient(_RestClient):
    def get_database(self, database_id: str) -> dict[str, object]:
        return {
            "id": database_id, "title": [{"plain_text": "Tasks"}], "properties": {
                "Name": {"id": "title", "type": "title", "title": {}},
                "Links": {"id": "links", "type": "relation", "relation": {"database_id": database_id}},
            },
        }


@pytest.mark.parametrize("exact", [True, False])
@pytest.mark.usefixtures("isolated_runtime")
def check_verify_cli_report_and_exit_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], exact: bool,
) -> None:
    from backend.services.integration_manager import integration_manager
    from backend.services.notion_clone import clone_page_id, clone_table_id, clone_table_schema
    from pipeline.skills.notion_clone.scripts import verify_notion_table_exact as verify

    client = _DatabaseClient()
    client.rows = [{"id": "row", "properties": {
        "Name": {"type": "title", "title": [{"plain_text": "A---B"}]},
        "Links": {"type": "relation", "relation": [{"id": "row"}]},
    }}]
    table = clone_table_schema(client.get_database("database"))
    table.update({"database_id": "local-db", "folder": "Tasks", "opaque": {"keep": [None]}})
    registry = tmp_path / "BD" / "vault_db_registry.json"
    original = json.dumps({"tables": [table], "databases": [{"id": "local-db", "folder": "BD/Notion"}]})
    _write(registry, original)
    page_id = clone_page_id("row")
    page = tmp_path / "BD" / "Notion" / "Tasks" / "row.md"
    extra = "" if exact else "undeclared: [1, 2]\n"
    raw = (
        f'---\nid: {page_id}\ntable_id: {clone_table_id("database")}\ntitle: A---B\n'
        f'Name: A---B\nLinks: ["[[A---B|{page_id}]]"]\n{extra}---\nBody\n'
    )
    _write(page, raw)
    output = tmp_path / "reports" / "report.json"
    monkeypatch.setattr(integration_manager, "get_raw", lambda name: {"token": "synthetic"})
    monkeypatch.setattr(verify, "NotionClient", lambda token: client)
    monkeypatch.setattr(sys, "argv", [
        "verify", "--database-id", "database", "--vault", str(tmp_path), "--output", str(output),
    ])
    assert verify.main() == (0 if exact else 1)
    report = json.loads(output.read_text())
    assert report["summary"]["exact"] is exact
    assert report["summary"]["undeclared_properties"] == (0 if exact else 1)
    assert report["source_database_id"] == "database"
    assert report["clone_table_id"] == clone_table_id("database")
    assert report["clone_folder"] == str(page.parent)
    assert json.loads(capsys.readouterr().out) == report
    assert page.read_text() == raw and registry.read_text() == original


@pytest.mark.parametrize("field,value", [("tables", {}), ("tables", [None]), ("databases", None)])
@pytest.mark.usefixtures("isolated_runtime")
def check_verify_malformed_registry_never_writes_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, field: str, value: object,
) -> None:
    from backend.services.integration_manager import integration_manager
    from pipeline.skills.notion_clone.scripts import verify_notion_table_exact as verify

    registry = tmp_path / "BD" / "vault_db_registry.json"
    raw = json.dumps({"tables": [], "databases": [], field: value})
    _write(registry, raw)
    output = tmp_path / "report.json"
    _write(output, "Previous report")
    monkeypatch.setattr(integration_manager, "get_raw", lambda name: {"token": "synthetic"})
    monkeypatch.setattr(verify, "NotionClient", _DatabaseClient)
    monkeypatch.setattr(sys, "argv", [
        "verify", "--database-id", "database", "--vault", str(tmp_path), "--output", str(output),
    ])
    with pytest.raises(ValueError):
        verify.main()
    assert output.read_text() == "Previous report" and registry.read_text() == raw
