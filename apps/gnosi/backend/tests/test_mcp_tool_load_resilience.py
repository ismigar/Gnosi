"""get_mcp_tools must isolate malformed MCP definitions.

Definitions come from third-party MCP servers. A single one missing `name`
(or with a weird schema) must NOT bring down the rest of the MCP tools or the
whole agent — previously the list comprehension propagated the exception and ALL of them were lost.
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
    # The two good ones load; the bad one is skipped.
    assert len(tools) == 2
    assert all(t.name == "search" for t in tools)


def test_empty_and_none_are_safe():
    assert get_mcp_tools([], _FakeClient()) == []
    assert get_mcp_tools(None, _FakeClient()) == []
    # Non-dict elements don't fail either.
    assert get_mcp_tools([None, "x", 123, _GOOD], _FakeClient()) and \
        len(get_mcp_tools([None, "x", 123, _GOOD], _FakeClient())) == 1


def test_good_def_still_loads_with_schema():
    tools = get_mcp_tools([_GOOD], _FakeClient())
    assert len(tools) == 1
    t = tools[0]
    assert t.name == "search"
    # The required schema field is present.
    assert "q" in t.args_schema.model_fields
