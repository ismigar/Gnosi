"""MultiServerMCPClient.call_tool must resolve the server from a cache.

Previously it called get_all_tools() (a `tools/list` per MCP server) on EVERY
invocation just to find out who has the tool. Now the tool→server cache does it in
O(1) and only refreshes on a miss.
"""
import asyncio

import pytest

from backend.mcp.client import DockerMCPClient, MultiServerMCPClient


class _FakeClient:
    def __init__(self, name):
        self.name = name
        self.calls = []

    async def call_tool(self, name, args):
        self.calls.append((name, args))
        return {"ok": name}


def _make(list_tools_sequence):
    mc = MultiServerMCPClient({})
    mc.clients = {"s1": _FakeClient("s1"), "s2": _FakeClient("s2")}
    state = {"n": 0}

    async def fake_get_all_tools():
        i = min(state["n"], len(list_tools_sequence) - 1)
        state["n"] += 1
        return list_tools_sequence[i]

    mc.get_all_tools = fake_get_all_tools
    mc._state = state
    return mc


def test_routing_cached_after_first_call():
    mc = _make([[{"name": "search", "server": "s1"}]])

    async def run():
        await mc.call_tool("search", {"q": 1})
        await mc.call_tool("search", {"q": 2})

    asyncio.run(run())
    assert mc._state["n"] == 1, "get_all_tools només un cop (2a crida = cache hit)"
    assert len(mc.clients["s1"].calls) == 2


def test_unknown_tool_refreshes_once_then_raises():
    mc = _make([[{"name": "search", "server": "s1"}]])
    with pytest.raises(ValueError):
        asyncio.run(mc.call_tool("missing", {}))
    assert mc._state["n"] == 1, "un miss refresca exactament un cop"


def test_tool_appears_after_refresh():
    mc = _make([
        [{"name": "search", "server": "s1"}],
        [{"name": "search", "server": "s1"}, {"name": "later", "server": "s2"}],
    ])

    async def run():
        await mc.call_tool("search", {})        # construeix la cache (n=1)
        return await mc.call_tool("later", {})  # miss → refresc (n=2) → trobada

    res = asyncio.run(run())
    assert res == {"ok": "later"}
    assert mc._state["n"] == 2
    assert len(mc.clients["s2"].calls) == 1


def test_stale_server_in_cache_triggers_refresh():
    # The cache points to a server that is no longer in self.clients → refreshes.
    mc = _make([[{"name": "search", "server": "s1"}]])
    mc._tool_server_cache = {"search": "servidor-mort"}
    asyncio.run(mc.call_tool("search", {}))
    assert mc._state["n"] == 1
    assert len(mc.clients["s1"].calls) == 1


def test_list_tools_rejects_non_object_response(monkeypatch):
    client = DockerMCPClient("invalid", ["unused"])

    async def fake_send_request(method, params=None, timeout=30.0):
        assert method == "tools/list"
        return []

    monkeypatch.setattr(client, "send_request", fake_send_request)

    with pytest.raises(RuntimeError, match="invalid tools/list response"):
        asyncio.run(client.list_tools())
