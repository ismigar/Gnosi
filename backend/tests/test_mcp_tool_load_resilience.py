"""get_mcp_tools ha d'aïllar les definicions MCP mal formades.

Les definicions venen de servidors MCP de tercers. Una de sola sense `name`
(o amb schema estrany) NO ha de tombar la resta de tools MCP ni l'agent
sencer — abans la list-comprehension propagava l'excepció i es perdien TOTES.
"""
from backend.agent.tools import get_mcp_tools, create_mcp_tool


class _FakeClient:
    pass


_GOOD = {
    "name": "search",
    "description": "cerca",
    "inputSchema": {"properties": {"q": {"type": "string"}}, "required": ["q"]},
}


def test_malformed_def_does_not_break_the_rest():
    noname = {"description": "sense name", "inputSchema": {}}
    tools = get_mcp_tools([_GOOD, noname, _GOOD], _FakeClient())
    # Les dues bones es carreguen; la dolenta se salta.
    assert len(tools) == 2
    assert all(t.name == "search" for t in tools)


def test_empty_and_none_are_safe():
    assert get_mcp_tools([], _FakeClient()) == []
    assert get_mcp_tools(None, _FakeClient()) == []
    # Elements no-dict tampoc no peten.
    assert get_mcp_tools([None, "x", 123, _GOOD], _FakeClient()) and \
        len(get_mcp_tools([None, "x", 123, _GOOD], _FakeClient())) == 1


def test_good_def_still_loads_with_schema():
    tools = get_mcp_tools([_GOOD], _FakeClient())
    assert len(tools) == 1
    t = tools[0]
    assert t.name == "search"
    # El camp requerit del schema hi és.
    assert "q" in t.args_schema.model_fields
