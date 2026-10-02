import asyncio
import os
from pathlib import Path
import sys
from importlib.metadata import PackageNotFoundError, version

import httpx
import pytest

try:
    version("mcp")
except PackageNotFoundError:
    pytest.skip("MCP SDK is not installed; standalone connector acceptance is pending", allow_module_level=True)
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.shared.memory import create_connected_server_and_client_session

from gnosi_connector.client import Config, ConnectorError, GnosiClient, load_profile, origin
from gnosi_connector.server import BearerGuard, create_server


def run(awaitable):
    return asyncio.run(awaitable)


def fixture_client(handler=None, scopes="read"):
    calls = []

    def respond(request):
        calls.append(request)
        assert request.method == "GET"
        assert request.headers["authorization"] == "Bearer gnosi_pat_fixture"
        if request.url.path == "/api/public/ping":
            return httpx.Response(200, json={"ok": True, "scopes": scopes})
        if request.url.path == "/api/vaults":
            return httpx.Response(200, json={"vaults": [{"id": "v1", "name": "Research", "slug": "research"}]})
        assert request.url.path.startswith("/api/v1/vaults/research/knowledge/")
        if handler:
            return handler(request)
        if request.url.path.endswith("/pages/p1"):
            return httpx.Response(200, json={"id": "p1", "title": "Cafè", "content": "A note"})
        if request.url.path.endswith("/tables"):
            return httpx.Response(200, json=[{"id": "t1", "name": "Books", "database_id": "d1"}])
        return httpx.Response(200, json=[{"id": "p1", "title": "Cafè", "folder": "Notes", "path": "/private/never-return.md"}])

    config = Config("http://localhost:5002", "research", "gnosi_pat_fixture", "https://gnosi.example")
    return GnosiClient(config, httpx.MockTransport(respond)), calls


def test_mcp_discovery_and_all_tools():
    async def scenario():
        client, calls = fixture_client()
        async with create_connected_server_and_client_session(create_server(client)) as session:
            tools = (await session.list_tools()).tools
            assert {tool.name for tool in tools} == {"list_vaults", "search", "fetch", "list_pages", "list_tables", "prepare_page_change", "commit_page_change"}
            assert all(tool.annotations.readOnlyHint and not tool.annotations.destructiveHint for tool in tools if tool.name != "commit_page_change")
            commit = next(tool for tool in tools if tool.name == "commit_page_change")
            assert not commit.annotations.readOnlyHint and commit.annotations.destructiveHint
            for name, args in [("search", {"query": "CAFÈ"}), ("fetch", {"id": "p1"}),
                               ("list_pages", {}), ("list_tables", {}), ("list_vaults", {})]:
                result = await session.call_tool(name, args)
                assert not result.isError
                text = result.content[0].text
                assert "gnosi_pat_" not in text and "/private/" not in text
            invalid = await session.call_tool("fetch", {"id": "../tokens"})
            assert invalid.isError
        assert len([c for c in calls if c.url.path == "/api/public/ping"]) == 5
    run(scenario())


@pytest.mark.parametrize("scope", ["", "write", "bread"])
def test_missing_read_scope_prevents_data_request(scope):
    client, calls = fixture_client(scopes=scope)
    with pytest.raises(ConnectorError, match="read scope"):
        run(client.fetch("p1"))
    assert len(calls) == 1


@pytest.mark.parametrize("identifier", ["../tokens", "..", "p/1", "%2e%2e", "https://evil.test", ""])
def test_path_injection_is_rejected_before_network(identifier):
    client, calls = fixture_client()
    with pytest.raises(ConnectorError):
        run(client.fetch(identifier))
    assert not calls


@pytest.mark.parametrize("status", [301, 302, 401, 403, 404, 503])
def test_failures_do_not_leak_body_or_follow_redirects(status):
    client, calls = fixture_client(lambda request: httpx.Response(status,
        headers={"Location": "https://evil.test"}, text="gnosi_pat_secret /private/file"))
    with pytest.raises(ConnectorError) as caught:
        run(client.fetch("p1"))
    assert "gnosi_pat" not in str(caught.value)
    assert len(calls) == 2


def test_revoked_token_is_rejected_even_after_success():
    count = 0
    def respond(request):
        nonlocal count
        count += 1
        return httpx.Response(200, json={"ok": True, "scopes": "read"}) if count == 1 else httpx.Response(401)
    client = GnosiClient(Config("http://localhost", "main", "gnosi_pat_fixture"), httpx.MockTransport(respond))
    run(client.authorize())
    with pytest.raises(ConnectorError, match="401"):
        run(client.authorize())


def test_page_pagination_and_content_truncation():
    client, _ = fixture_client(lambda request: httpx.Response(200, json=[
        {"id": f"p{i}", "title": str(i)} for i in range(3)]))
    result = run(client.pages(limit=2, offset=8))
    assert len(result["pages"]) == 2 and result["next_offset"] == 10
    client, _ = fixture_client(lambda request: httpx.Response(200, json={"content": "x" * 60001}))
    result = run(client.fetch("p1"))
    assert result["truncated"] and len(result["text"]) == 60000


def test_search_reports_partial_when_scan_budget_exhausted():
    client, calls = fixture_client(lambda request: httpx.Response(200, json=[
        {"id": f"p{i}", "title": "Unrelated"} for i in range(250)]))
    result = run(client.search("missing"))
    assert result["partial"] and result["results"] == []
    assert len(calls) == 21


def test_oversized_response_is_rejected():
    client, _ = fixture_client(lambda request: httpx.Response(200, content=b"x" * 4_000_001))
    with pytest.raises(ConnectorError, match="4 MB"):
        run(client.fetch("p1"))


@pytest.mark.parametrize("url", ["file:///etc/passwd", "https://user:password@host", "https://host/api", "http://remote.test"])
def test_unsafe_origin(url):
    with pytest.raises(ConnectorError):
        origin(url)


def test_secret_file_config_and_redacted_repr(monkeypatch, tmp_path):
    for key in list(os.environ):
        if key.startswith("GNOSI_"):
            monkeypatch.delenv(key)
    token_file = tmp_path / "secret"
    token_file.write_text("gnosi_pat_fixture\n")
    monkeypatch.setenv("GNOSI_TOKEN_FILE", str(token_file))
    monkeypatch.setenv("GNOSI_VAULT_SLUG", "research")
    config = Config.from_env()
    assert config.token == "gnosi_pat_fixture" and "gnosi_pat" not in repr(config)
    monkeypatch.setenv("GNOSI_TOKEN", "gnosi_pat_other")
    with pytest.raises(ConnectorError, match="Set only"):
        Config.from_env()


def test_explicit_profile_selects_vault_and_rejects_embedded_secrets(monkeypatch, tmp_path):
    monkeypatch.setenv("GNOSI_VAULT_SLUG", "other")
    monkeypatch.setenv("GNOSI_TOKEN", "gnosi_pat_old")
    monkeypatch.delenv("GNOSI_TOKEN_FILE", raising=False)
    profile = tmp_path / "profile.json"
    profile.write_text('{"GNOSI_VAULT_SLUG":"principal","GNOSI_TOKEN_FILE":"/private/token"}')
    load_profile(str(profile))
    assert os.environ["GNOSI_VAULT_SLUG"] == "principal"
    assert "GNOSI_TOKEN" not in os.environ
    profile.write_text('{"GNOSI_TOKEN":"gnosi_pat_do_not_embed"}')
    with pytest.raises(ConnectorError, match="Invalid profile"):
        load_profile(str(profile))


def test_http_key_must_be_separate_and_long():
    with pytest.raises(ConnectorError, match="32 characters"):
        BearerGuard(None, "short")


def test_http_authentication_and_protocol():
    async def scenario():
        client, _ = fixture_client()
        server = create_server(client)
        app = BearerGuard(server.streamable_http_app(), "x" * 32)
        async with server.session_manager.run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://localhost") as http:
                body = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                    "protocolVersion": "2025-03-26", "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"}}}
                headers = {"Accept": "application/json, text/event-stream"}
                assert (await http.post("/mcp", json=body, headers=headers)).status_code == 401
                headers["Authorization"] = "Bearer " + "x" * 32
                response = await http.post("/mcp", json=body, headers=headers)
                assert response.status_code == 200, response.text
                assert response.json()["result"]["serverInfo"]["name"] == "Gnosi"
                response = await http.post("/mcp", json={"jsonrpc": "2.0", "id": 2,
                    "method": "tools/call", "params": {"name": "fetch", "arguments": {"id": "p1"}}}, headers=headers)
                assert response.status_code == 200 and not response.json()["result"].get("isError")
                headers["Host"] = "evil.test"
                assert (await http.post("/mcp", json=body, headers=headers)).status_code == 421
    run(scenario())


def test_stdio_process_initializes_and_discovers_tools():
    async def scenario():
        env = {key: value for key, value in os.environ.items() if not key.startswith("GNOSI_")}
        env.update(GNOSI_TOKEN="gnosi_pat_fixture", GNOSI_VAULT_SLUG="research")
        params = StdioServerParameters(command=sys.executable,
            args=["-m", "gnosi_connector.server"], env=env, cwd=str(Path(__file__).parents[1]))
        async with stdio_client(params) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                assert len((await session.list_tools()).tools) == 7
    run(scenario())


def multi_client(default="principal", denied_status=403):
    calls = []
    def respond(request):
        calls.append(request.url.path)
        if request.url.path == "/api/public/ping":
            return httpx.Response(200, json={"ok": True, "scopes": "read"})
        if request.url.path == "/api/vaults":
            return httpx.Response(200, json={"active_path": "/private", "vaults": [
                {"id": slug, "name": slug.title(), "slug": slug, "path": "/private/" + slug}
                for slug in ["principal", "proves", "denied"]]})
        slug = request.url.path.split("/")[4]
        if slug == "denied":
            return httpx.Response(denied_status)
        if slug not in {"principal", "proves"}:
            return httpx.Response(404)
        if request.url.path.endswith("/pages/shared-id"):
            return httpx.Response(200, json={"id": "shared-id", "title": slug, "content": slug})
        if request.url.path.endswith("/tables"):
            return httpx.Response(200, json=[{"id": "t1", "name": slug}])
        return httpx.Response(200, json=[{"id": "shared-id", "title": slug}])
    return GnosiClient(Config("http://localhost", default, "gnosi_pat_fixture", "https://gnosi.example"),
                       httpx.MockTransport(respond)), calls


def test_discover_filters_denied_vaults_and_hides_filesystem_paths():
    client, _ = multi_client()
    result = run(client.vaults())
    assert [v["slug"] for v in result["vaults"]] == ["principal", "proves"]
    assert result["vaults"][0]["default"] and not result["vaults"][1]["default"]
    assert "/private" not in str(result)
    first = run(client.vaults(limit=1))
    assert first["next_offset"] == 1
    denied = run(client.vaults(limit=1, offset=2))
    assert denied["vaults"] == [] and denied["next_offset"] is None


def test_parallel_vault_calls_do_not_change_default_or_cross_results():
    async def scenario():
        client, _ = multi_client()
        principal, proves = await asyncio.gather(client.fetch("shared-id"), client.fetch("shared-id", "proves"))
        assert principal["text"] == principal["vault"] == "principal"
        assert proves["text"] == proves["vault"] == "proves"
        assert "/@proves/" in proves["url"] and "/@principal/" in principal["url"]
        assert (await client.fetch("shared-id"))["vault"] == "principal"
        assert (await client.search("proves", "proves"))["results"][0]["title"] == "proves"
        assert (await client.pages(vault="proves"))["vault"] == "proves"
        assert (await client.tables(vault="proves"))["tables"][0]["name"] == "proves"
    run(scenario())


@pytest.mark.parametrize("vault", ["../principal", "", "https://evil.test", "%2f", "a/b"])
def test_invalid_vault_is_rejected_before_network(vault):
    client, calls = multi_client()
    with pytest.raises(ConnectorError):
        run(client.pages(vault=vault))
    assert calls == []


@pytest.mark.parametrize("vault,status", [("denied", 403), ("missing", 404)])
def test_vault_access_errors_never_fall_back_to_default(vault, status):
    client, calls = multi_client()
    with pytest.raises(ConnectorError, match=str(status)):
        run(client.fetch("shared-id", vault))
    assert not any("/principal/" in path for path in calls)


def test_discovery_does_not_hide_authentication_or_server_errors():
    client, _ = multi_client(denied_status=401)
    with pytest.raises(ConnectorError, match="401"):
        run(client.vaults())


def test_no_default_allows_discovery_but_requires_explicit_selection():
    client, _ = multi_client(default="")
    assert run(client.vaults())["default_vault"] is None
    with pytest.raises(ConnectorError, match="Choose a vault"):
        run(client.pages())
    assert run(client.fetch("shared-id", "proves"))["vault"] == "proves"


@pytest.mark.parametrize("identifier", ["Welcome to Gnosi", "DESDE EL REINO DE LOS SUEÑOS", "Cafè 100% #1?"])
def test_legacy_title_ids_are_encoded_once_and_roundtrip(identifier):
    from urllib.parse import quote
    def respond(request):
        assert request.url.path.endswith("/pages/" + identifier)
        assert not request.url.query and not request.url.fragment
        return httpx.Response(200, json={"id": identifier, "content": "note"})
    client, _ = fixture_client(respond)
    result = run(client.fetch(identifier))
    assert result["id"] == identifier
    assert result["url"].endswith("/page/" + quote(identifier, safe=""))
    assert client.summary({"id": identifier})["id"] == identifier
