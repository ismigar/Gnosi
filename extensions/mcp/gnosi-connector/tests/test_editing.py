import asyncio
import json

import httpx
import pytest

from gnosi_connector.client import Config, ConnectorError, GnosiClient
from gnosi_connector.editing import Editing


@pytest.mark.parametrize("identifier", [None, "page1"])
@pytest.mark.parametrize("conflict", [False, True])
def test_proposal_commit_and_replay(identifier, conflict):
    async def scenario():
        writes = []

        def respond(request):
            if request.url.path == "/api/public/ping":
                return httpx.Response(200, json={"ok": True, "scopes": "read,write"})
            if request.method == "GET":
                return httpx.Response(200, json={"title": "Before", "content": "Keep", "etag": "v1"})
            writes.append(request)
            return httpx.Response(409 if conflict else 200, json={"id": "page1", "status": "success"})

        editing = Editing(GnosiClient(Config("http://localhost", "default", "gnosi_pat_test"), httpx.MockTransport(respond)))
        proposal = await editing.prepare("chosen", "After", "New body", identifier)
        assert not writes
        if conflict:
            with pytest.raises(ConnectorError, match="Page changed"):
                await editing.commit(proposal["proposal_id"])
        else:
            assert (await editing.commit(proposal["proposal_id"]))["vault"] == "chosen"
        assert len(writes) == 1
        assert writes[0].method == ("POST" if identifier is None else "PATCH")
        body = json.loads(writes[0].content)
        assert "force" not in body and "metadata" not in body
        if identifier:
            assert body["expected_etag"] == "v1"
        with pytest.raises(ConnectorError, match="already attempted"):
            await editing.commit(proposal["proposal_id"])
        assert len(writes) == 1
    asyncio.run(scenario())


def test_read_token_cannot_prepare_write():
    from test_connector import fixture_client
    client, calls = fixture_client()
    with pytest.raises(ConnectorError, match="read and write"):
        asyncio.run(Editing(client).prepare("research", "Title", "Body"))
    assert len(calls) == 1


def test_expired_and_unknown_proposals_never_write():
    from test_connector import fixture_client
    client, calls = fixture_client()
    editing = Editing(client)
    editing.pending["expired"] = (0, "research", None, {})
    for proposal in ["expired", "unknown"]:
        with pytest.raises(ConnectorError):
            asyncio.run(editing.commit(proposal))
    assert not calls
