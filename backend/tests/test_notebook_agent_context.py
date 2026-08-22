import json

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from backend.agent.agent_context import build_context_tools, normalize_refs
from backend.agent.factory import build_agent_turn_plan
from backend.agent.turn_contract import verify_response
from backend.agent.web_context import wrap_untrusted
from backend.api.agent_routes import TurnContextRef
from backend.services import notebook_service


def test_notebook_turn_ref_discards_client_revision():
    ref = TurnContextRef(
        id="notebook:test",
        type="notebook",
        ref="notebook-id",
        label="Research",
        scope={"revision": 999},
    )
    assert ref.type == "notebook"
    assert ref.scope == {}


def test_normalized_notebook_ref_requires_server_pinned_revision():
    assert normalize_refs([{
        "id": "notebook:test",
        "type": "notebook",
        "ref": "notebook-id",
        "scope": {},
    }]) == []
    normalized = normalize_refs([{
        "id": "notebook:test",
        "type": "notebook",
        "ref": "notebook-id",
        "label": "Research",
        "scope": {"revision": 3},
    }])
    assert normalized[0]["scope"] == {"revision": 3}


def test_notebook_context_requires_real_search_and_exposes_read_only_tools(monkeypatch):
    refs = [{
        "id": "notebook:test",
        "type": "notebook",
        "ref": "notebook-id",
        "label": "Research",
        "scope": {"revision": 3},
    }]
    monkeypatch.setattr(
        notebook_service,
        "search_notebook",
        lambda notebook_id, query, revision, limit: {
            "notebook_id": notebook_id,
            "revision": revision,
            "query": query,
            "results": [{"chunk_id": "chunk-1", "text": "Evidence"}],
        },
    )
    tools = build_context_tools(refs)
    names = {tool.name for tool in tools}
    assert {
        "inspect_notebook_context",
        "search_notebook_context",
        "read_notebook_context_evidence",
    }.issubset(names)
    assert not names.intersection({"write_page", "delete_page", "run_mcp_tool"})

    search_tool = next(tool for tool in tools if tool.name == "search_notebook_context")
    result = search_tool.invoke({"query": "What is supported?", "limit": 5})
    assert "EXTERNAL CONTENT" in result
    assert '"revision": 3' in result
    raw_id_result = search_tool.invoke({
        "source_id": "notebook-id",
        "query": "What is supported?",
        "limit": 5,
    })
    assert '"notebook_id": "notebook-id"' in raw_id_result

    plan = build_agent_turn_plan("Hello", context_refs=refs)
    assert plan["required_tool"] == "search_notebook_context"


def test_notebook_chat_citations_preserve_exact_document_links():
    refs = [{
        "id": "notebook:test",
        "type": "notebook",
        "ref": "notebook-id",
        "label": "Research",
        "scope": {"revision": 3},
    }]
    plan = build_agent_turn_plan(
        "Where does the document support this?",
        context_refs=refs,
    )
    citation_href = (
        "gnosi-cite:?res=resource-1&notebook=notebook-id&revision=3"
        "&chunk=chunk-1&page=7"
    )
    payload = {
        "notebook_id": "notebook-id",
        "revision": 3,
        "results": [{
            "chunk_id": "chunk-1",
            "source_id": "source-1",
            "resource_id": "resource-1",
            "source_label": "Research paper.pdf",
            "text": "Exact grounded evidence.",
            "citation": {
                "href": citation_href,
                "label": "p. 7",
                "revision": 3,
                "source_id": "source-1",
                "chunk_id": "chunk-1",
            },
        }],
    }
    verified = verify_response(
        AIMessage(content="The finding appears in the paper [[cite:chunk-1]]."),
        messages=[
            HumanMessage(content="Where does the document support this?"),
            ToolMessage(
                content=wrap_untrusted("Notebook search", json.dumps(payload)),
                name="search_notebook_context",
                tool_call_id="call-notebook-search",
            ),
        ],
        plan=plan,
    )

    citations = verified.additional_kwargs["gnosi_citations"]
    assert citations["status"] == "complete"
    assert citations["sources"] == [{
        "citation_id": citations["sources"][0]["citation_id"],
        "source_id": "chunk-1",
        "title": "Research paper.pdf · p. 7",
        "source_type": "notebook_evidence",
        "href": citation_href,
        "source_version": citations["sources"][0]["source_version"],
        "version_status": "exact",
    }]
    assert "[[cite:" not in verified.content
    assert verified.additional_kwargs["gnosi_verification"]["checks"][
        "claim_citations_complete"
    ] is True
