"""Exercise real handlers with in-memory HTTP streams and synthetic host calls."""

from __future__ import annotations

import io
import json
import os
import subprocess
from collections.abc import Mapping
from http.client import HTTPMessage
from pathlib import Path
from types import SimpleNamespace

import pytest

# Importing the helper resolves HOME once. Even that resolution uses a fixture
# location; no backend configuration, user directories or services are loaded.
with pytest.MonkeyPatch.context() as import_patch:
    import_patch.setattr(Path, "home", lambda: Path("/private/tmp"))
    from pipeline.skills.host_open_helper.scripts import host_open_helper as host


class HTTPFixture(host.Handler):
    """Inject streams into the actual handler, including its HTTP serializer."""

    def __init__(self, method: str, route: str, body: bytes) -> None:
        self.command = method
        self.path = route
        self.requestline = f"{method} {route} HTTP/1.1"
        self.request_version = "HTTP/1.1"
        self.client_address = ("127.0.0.1", 12345)
        self.headers = HTTPMessage()
        self.headers["Content-Length"] = str(len(body))
        self.rfile = io.BytesIO(body)
        self.output = io.BytesIO()
        self.wfile = self.output


def request(
    route: str,
    payload: object = None,
    *,
    method: str = "POST",
    raw: bytes | None = None,
) -> tuple[int, dict[str, str], object]:
    handler = HTTPFixture(method, route, json.dumps(payload).encode() if raw is None else raw)
    if method == "GET":
        handler.do_GET()
    else:
        handler.do_POST()
    head, _, body = handler.output.getvalue().partition(b"\r\n\r\n")
    lines = head.decode().split("\r\n")
    status = int(lines[0].split()[1])
    headers = dict(line.split(": ", 1) for line in lines[1:])
    assert headers["Content-Type"] == "application/json"
    assert int(headers["Content-Length"]) == len(body)
    result: object = json.loads(body)
    return status, headers, result


def blocked_system_call(*args: object, **kwargs: object) -> None:
    pytest.fail("A real subprocess or host operation must never run in these tests")


@pytest.fixture(autouse=True)
def synthetic_host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(host, "HOME", tmp_path)
    monkeypatch.setenv("GNOSI_OPEN_ROOTS", str(tmp_path))
    monkeypatch.setattr(subprocess, "run", blocked_system_call)
    monkeypatch.setattr(subprocess, "Popen", blocked_system_call)
    monkeypatch.setattr(os, "startfile", blocked_system_call, raising=False)


def test_health_unknown_routes_and_http_headers(tmp_path: Path) -> None:
    status, _, body = request("/healthz", method="GET")
    assert (status, body) == (200, {"status": "ok", "roots": [str(tmp_path)]})
    for method, route in [("GET", "/missing"), ("POST", "/missing"), ("GET", "/open")]:
        status, _, body = request(route, method=method)
        assert (status, body) == (404, {"detail": "not found"})


@pytest.mark.parametrize("route", ["/open", "/trash", "/pick", "/search"])
def test_invalid_json_and_legacy_nonobject_bodies(route: str) -> None:
    status, _, body = request(route, raw=b"{")
    assert (status, body) == (400, {"detail": "invalid JSON"})
    null_handler = HTTPFixture("POST", route, b"null")
    null_handler.do_POST()
    assert null_handler.output.getvalue() == b""
    for payload in [1, True, "text", [1]]:
        handler = HTTPFixture("POST", route, json.dumps(payload).encode())
        with pytest.raises(AttributeError, match="has no attribute 'get'"):
            handler.do_POST()
        assert handler.output.getvalue() == b""


@pytest.mark.parametrize("payload", [{}, [], False, 0, ""])
def test_falsey_body_keeps_missing_path_response(payload: object) -> None:
    status, _, body = request("/open", payload)
    assert (status, body) == (400, {"detail": "missing 'path'"})


@pytest.mark.parametrize("route", ["/open", "/trash"])
def test_path_errors_permission_order_and_symlinks(
    route: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.write_text("fixture", encoding="utf-8")
    link = allowed / "escape"
    link.symlink_to(outside)
    monkeypatch.setenv("GNOSI_OPEN_ROOTS", str(allowed))
    for target in [outside, link]:
        status, _, body = request(route, {"path": str(target), "opaque": [None, {"x": 1}]})
        assert (status, body) == (403, {"detail": f"path outside allowed roots: {target}"})
    missing = tmp_path / "missing"
    status, _, body = request(route, {"path": str(missing)})
    assert (status, body) == (404, {"detail": f"path not found: {missing}"})
    status, _, body = request(route, {})
    assert (status, body) == (400, {"detail": "missing 'path'"})

    def invalid_path(raw: str) -> Path:
        raise ValueError("fixture normalization failure")

    monkeypatch.setattr(host, "_normalize_path", invalid_path)
    status, _, body = request(route, {"path": "fixture"})
    assert (status, body) == (400, {"detail": "invalid path"})


@pytest.mark.parametrize(
    "route,operation", [("/open", "_open_with_system"), ("/trash", "_move_to_trash")]
)
def test_open_and_trash_success_and_failures(
    route: str,
    operation: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / 'file " $(touch injected).txt'
    target.write_text("fixture", encoding="utf-8")
    calls: list[Path] = []
    monkeypatch.setattr(host, operation, calls.append)
    status, _, body = request(route, {"path": target.as_uri(), "unused": {"opaque": True}})
    expected = {"status": "ok", "target": str(target)}
    if route == "/open":
        expected["kind"] = "file"
    assert (status, body) == (200, expected)
    assert calls == [target]

    def fail(path: Path) -> None:
        raise OSError("fixture denial")

    monkeypatch.setattr(host, operation, fail)
    status, _, body = request(route, {"path": str(target)})
    assert (status, body) == (500, {"detail": f"could not {route[1:]}: fixture denial"})


def test_path_coercion_url_fallback_and_unrestricted_roots(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "123").write_text("fixture", encoding="utf-8")
    calls: list[Path] = []
    monkeypatch.setattr(host, "_open_with_system", calls.append)
    monkeypatch.delenv("GNOSI_OPEN_ROOTS")
    assert host._allowed_roots() == []
    assert host._is_path_allowed(tmp_path)
    status, _, body = request("/open", {"path": 123})
    assert (status, body) == (200, {"status": "ok", "target": "123", "kind": "file"})
    status, _, body = request("/open", {"path": False, "url": tmp_path.as_uri()})
    assert (status, body) == (200, {"status": "ok", "target": str(tmp_path), "kind": "dir"})
    assert calls == [Path("123"), tmp_path]
    assert host._normalize_path("file://server/a%20b") == Path("//server/a b")
    assert host._normalize_path("  FILE:///tmp/a%20b  ") == Path("/tmp/a b")
    monkeypatch.setenv("GNOSI_OPEN_ROOTS", f"{tmp_path}: :{tmp_path / 'other'}")
    assert host._allowed_roots() == [tmp_path, tmp_path / "other"]


@pytest.mark.parametrize(
    "platform,os_name,command",
    [("darwin", "posix", "open"), ("linux", "posix", "xdg-open"), ("win32", "nt", "startfile")],
)
def test_open_uses_exact_argv_without_shell(
    platform: str,
    os_name: str,
    command: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / '--name " ; $(touch fake)'
    calls: list[object] = []

    def popen(argv: list[str]) -> object:
        calls.append(argv)
        return object()

    monkeypatch.setattr(host, "sys", SimpleNamespace(platform=platform))
    monkeypatch.setattr(host, "os", SimpleNamespace(name=os_name, startfile=calls.append))
    monkeypatch.setattr(subprocess, "Popen", popen)
    host._open_with_system(target)
    assert calls == ([str(target)] if command == "startfile" else [[command, str(target)]])


def test_trash_argv_error_and_unsupported_platform(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / 'quoted " ; $(touch fake)'
    calls: list[list[str]] = []
    returncode = 0

    def run(
        argv: list[str], *, capture_output: bool, text: bool, timeout: int
    ) -> subprocess.CompletedProcess[str]:
        assert (capture_output, text, timeout) == (True, True, 30)
        calls.append(argv)
        return subprocess.CompletedProcess(argv, returncode, "", " fixture error \n")

    monkeypatch.setattr(host, "sys", SimpleNamespace(platform="darwin"))
    monkeypatch.setattr(subprocess, "run", run)
    host._move_to_trash(target)
    assert calls == [
        [
            "osascript",
            "-e",
            'on run argv\n  tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)\nend run',
            str(target),
        ]
    ]
    returncode = 1
    with pytest.raises(RuntimeError, match="^fixture error$"):
        host._move_to_trash(target)
    monkeypatch.setattr(host, "sys", SimpleNamespace(platform="linux"))
    with pytest.raises(RuntimeError, match="Trash is not supported on this platform"):
        host._move_to_trash(target)
    assert len(calls) == 2


def test_picker_argv_separators_cancellation_and_errors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file = tmp_path / "line\nbreak.txt"
    file.write_text("fixture", encoding="utf-8")
    directory = tmp_path / "folder"
    directory.mkdir()
    stdout = f"{file}{host._PICK_SEP}{directory}\n"
    returncode = 0
    calls: list[list[str]] = []

    def run(
        argv: list[str], *, capture_output: bool, text: bool, timeout: int
    ) -> subprocess.CompletedProcess[str]:
        assert (capture_output, text, timeout) == (True, True, 3600)
        calls.append(argv)
        return subprocess.CompletedProcess(argv, returncode, stdout, " fixture picker error ")

    monkeypatch.setattr(host, "sys", SimpleNamespace(platform="darwin"))
    monkeypatch.setattr(subprocess, "run", run)
    prompt = 'choose " ; $(touch fake)'
    result = host._native_choose("unexpected", prompt, True)
    assert result == {
        "status": "ok",
        "path": str(file),
        "paths": [str(file), str(directory)],
        "is_dir": False,
        "entries": [{"path": str(file), "is_dir": False}, {"path": str(directory), "is_dir": True}],
    }
    assert calls == [
        ["osascript", "-l", "JavaScript", "-e", host._PANEL_JXA, prompt, "any", "multi"]
    ]
    for mode in ["file", "folder", "any"]:
        stdout = "\n"
        assert host._native_choose(mode, "") == {"status": "cancelled"}
        assert calls[-1][-3:] == ["", mode, "single"]
    returncode = 1
    with pytest.raises(RuntimeError, match="^fixture picker error$"):
        host._native_choose("any", "")
    monkeypatch.setattr(host, "sys", SimpleNamespace(platform="linux"))
    with pytest.raises(RuntimeError, match="native picker only supported on macOS"):
        host._native_choose("any", "")


def test_pick_http_coercion_cancellation_and_error(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, bool]] = []

    def choose(mode: str, prompt: str, multiple: bool = False) -> host.PickCancelled:
        calls.append((mode, prompt, multiple))
        return {"status": "cancelled"}

    monkeypatch.setattr(host, "_native_choose", choose)
    status, _, body = request("/pick", {"mode": " FOLDER ", "prompt": 123, "multiple": "false"})
    assert (status, body) == (200, {"status": "cancelled"})
    request("/pick", {"mode": ["invalid"], "multiple": [], "metadata": None})
    assert calls == [("folder", "123", True), ("any", "", False)]

    def fail(mode: str, prompt: str, multiple: bool = False) -> host.PickCancelled:
        raise OSError("fixture picker")

    monkeypatch.setattr(host, "_native_choose", fail)
    status, _, body = request("/pick", {})
    assert (status, body) == (500, {"detail": "could not pick: fixture picker"})


@pytest.mark.parametrize(
    "limit,expected",
    [
        (None, 100),
        (0, 100),
        (-3, 1),
        (600, 500),
        ("12", 12),
        ("bad", 100),
        (2.9, 2),
        (True, 1),
        ([], 100),
        ([1], 100),
        ({"x": 1}, 100),
    ],
)
def test_search_http_limit_and_root_contract(
    limit: object,
    expected: int,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    calls: list[tuple[str, int, list[Path]]] = []

    def search(query: str, limit: int, roots: list[Path]) -> host.SearchOutcome:
        calls.append((query, limit, roots))
        return {"results": [], "truncated": False, "had_error": False, "errors": []}

    monkeypatch.setattr(host, "_run_spotlight_search", search)
    status, _, body = request(
        "/search",
        {
            "query": "  $(injection)  ",
            "limit": limit,
            "roots": [str(nested), str(tmp_path), str(tmp_path), str(tmp_path / "missing")],
            "unused": {"opaque": [None]},
        },
    )
    assert (status, body) == (200, {"results": [], "truncated": False, "engine": "spotlight"})
    assert calls == [("$(injection)", expected, [tmp_path])]


def test_search_root_fallback_coercion_and_short_queries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    monkeypatch.setenv("GNOSI_OPEN_ROOTS", str(allowed))
    calls: list[list[Path]] = []

    def search(query: str, limit: int, roots: list[Path]) -> host.SearchOutcome:
        calls.append(roots)
        return {"results": [], "truncated": False, "had_error": False, "errors": []}

    monkeypatch.setattr(host, "_run_spotlight_search", search)
    for roots in [None, [], [str(tmp_path)], [str(tmp_path / "missing")], "xy", False]:
        assert request("/search", {"query": 123, "roots": roots})[0] == 200
        assert calls[-1] == [tmp_path]  # HOME fallback remains even outside allowlist.
    request("/search", {"query": "ab", "roots": {str(allowed): "opaque"}})
    assert calls[-1] == [allowed]
    for invalid_roots in [True, 3, 1.5]:
        with pytest.raises(TypeError, match="object is not iterable"):
            request("/search", {"query": "ab", "roots": invalid_roots})
    for query in [None, "x", "  ", 0]:
        status, _, body = request("/search", {"query": query})
        assert (status, body) == (400, {"detail": "query too short (min 2 chars)"})


@pytest.mark.parametrize("partial", [False, True])
def test_search_http_partial_and_total_failure(
    partial: bool,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    results: list[host.SearchEntry] = []
    if partial:
        results.append({"name": "fixture", "path": str(tmp_path / "fixture"), "is_dir": False})

    def search(query: str, limit: int, roots: list[Path]) -> host.SearchOutcome:
        return {
            "results": results,
            "truncated": False,
            "had_error": True,
            "errors": ["fixture failure"],
        }

    monkeypatch.setattr(host, "_run_spotlight_search", search)
    status, _, body = request("/search", {"query": "ab"})
    if partial:
        assert (status, body) == (
            200,
            {"results": results, "truncated": True, "engine": "spotlight"},
        )
    else:
        assert (status, body) == (
            500,
            {"detail": "spotlight search failed", "errors": ["fixture failure"]},
        )

    def fail(query: str, limit: int, roots: list[Path]) -> host.SearchOutcome:
        raise OSError("fixture failure")

    monkeypatch.setattr(host, "_run_spotlight_search", fail)
    status, _, body = request("/search", {"query": "ab"})
    assert (status, body) == (500, {"detail": "search failed: fixture failure"})


def test_spotlight_argv_filtering_duplicates_and_truncation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file = tmp_path / "visible.txt"
    file.write_text("fixture", encoding="utf-8")
    directory = tmp_path / "folder"
    directory.mkdir()
    noise = [
        tmp_path / part / "hidden"
        for part in [".git", ".history", "node_modules", "__pycache__", "Trash"]
    ]
    calls: list[list[str]] = []

    def run(
        argv: list[str], *, capture_output: bool, text: bool, timeout: int
    ) -> subprocess.CompletedProcess[str]:
        assert (capture_output, text, timeout) == (True, True, 10)
        calls.append(argv)
        return subprocess.CompletedProcess(
            argv, 0, "\n".join(map(str, [file, file, *noise, directory])), "diagnostic"
        )

    monkeypatch.setattr(subprocess, "run", run)
    query = '-a " ; $(touch fake)'
    result = host._run_spotlight_search(query, 2, [tmp_path, directory])
    assert result == {
        "results": [
            {"name": file.name, "path": str(file), "is_dir": False},
            {"name": directory.name, "path": str(directory), "is_dir": True},
        ],
        "truncated": True,
        "had_error": False,
        "errors": [],
    }
    assert calls == [["mdfind", "-onlyin", str(tmp_path), "-name", query]]


@pytest.mark.parametrize("failure", ["timeout", "oserror", "exit"])
def test_spotlight_failure_reporting_and_partial_results(
    failure: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failing = tmp_path / "failing"
    success = tmp_path / "success"
    success.mkdir()

    def run(
        argv: list[str], *, capture_output: bool, text: bool, timeout: int
    ) -> subprocess.CompletedProcess[str]:
        if argv[2] == str(failing):
            if failure == "timeout":
                raise subprocess.TimeoutExpired(argv, timeout)
            if failure == "oserror":
                raise OSError("fixture missing command")
            return subprocess.CompletedProcess(argv, 2, "", "x" * 300)
        return subprocess.CompletedProcess(argv, 0, str(success), "")

    monkeypatch.setattr(subprocess, "run", run)
    result = host._run_spotlight_search("ab", 100, [failing, success])
    assert result["results"] == [{"name": success.name, "path": str(success), "is_dir": True}]
    assert result["had_error"] is True
    assert result["truncated"] is False
    assert len(result["errors"]) == 1
    assert result["errors"][0].startswith(f"{failing}:")
    if failure == "exit":
        assert result["errors"] == [f"{failing}: mdfind exit 2: " + "x" * 200]


def test_send_preserves_unicode_json_encoding() -> None:
    handler = HTTPFixture("GET", "/fixture", b"")
    payload: Mapping[str, object] = {"value": "català", "opaque": [1, None, {"ok": True}]}
    handler._send(200, payload)
    assert handler.output.getvalue().endswith(json.dumps(payload).encode())
