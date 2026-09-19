"""Dimensions API-key exchange and bounded POST transport contracts."""

import asyncio
import json

import httpx
import pytest

from backend.services import academic_connectors as connectors


def mock_http(monkeypatch, handler):
    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient",
        lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(connectors, "validate_public_https_url", lambda url: url)


def test_dimensions_exchanges_key_and_posts_query_with_token(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request)
        assert request.method == "POST"
        assert not request.url.query
        if request.url.path == "/api/auth":
            assert json.loads(request.content) == {"key": "test-api-key"}
            assert "authorization" not in request.headers
            return httpx.Response(200, json={"token": "test-access-token"})
        assert request.url.path == "/api/dsl/v2"
        assert request.headers["authorization"] == "JWT test-access-token"
        assert b'test-api-key' not in request.content
        assert b'limit 50' in request.content
        assert b'\\"quoted\\"' in request.content
        return httpx.Response(200, json={"publications": [{
            "id": "pub.1", "title": "Evidence", "year": 2026,
            "doi": "10.1000/example", "authors": [],
        }]})

    mock_http(monkeypatch, handler)
    audit_token, records = connectors.begin_request_audit()
    try:
        works = asyncio.run(connectors.search_dimensions('a "quoted" term', {}, 100, "test-api-key"))
    finally:
        connectors.end_request_audit(audit_token)
    assert len(requests) == 2
    assert works[0]["title"] == "Evidence"
    assert works[0]["identifiers"]["doi"] == "10.1000/example"
    assert [record["method"] for record in records] == ["POST", "POST"]
    assert "test-api-key" not in str(records)
    assert "test-access-token" not in str(records)


@pytest.mark.parametrize("payload", [{}, {"token": ""}, {"token": 42}, []])
def test_dimensions_rejects_invalid_token(monkeypatch, payload):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=payload)

    mock_http(monkeypatch, handler)
    with pytest.raises(connectors.ConnectorError, match="valid access token"):
        asyncio.run(connectors.search_dimensions("term", {}, 5, "key"))
    assert len(calls) == 1


def test_dimensions_requires_key_before_network(monkeypatch):
    def handler(request):
        pytest.fail("No network request should be made without a key")

    mock_http(monkeypatch, handler)
    with pytest.raises(connectors.ConnectorError, match="API key"):
        asyncio.run(connectors.search_dimensions("term", {}, 5, "  "))


@pytest.mark.parametrize("status, message", [
    (401, "credentials"), (403, "credentials"), (429, "rate limit"),
    (500, "HTTP 500"), (302, "redirected"), (307, "redirected"),
])
def test_post_failures_are_safe(monkeypatch, status, message):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={
            "location": "https://other.example/steal", "retry-after": "30",
        }, text="secret-key")

    mock_http(monkeypatch, handler)
    with pytest.raises(connectors.ConnectorError, match=message) as error:
        asyncio.run(connectors.search_dimensions("term", {}, 5, "secret-key"))
    assert "secret-key" not in str(error.value)
    assert len(calls) == 1
    if status == 429:
        assert error.value.retry_after == 30


@pytest.mark.parametrize("body, content_type, message", [
    (b'not JSON', 'application/json', 'invalid JSON'),
    (b'x' * 2048, 'application/json', 'size limit'),
    (b'<html>error</html>', 'text/html', 'unsupported content type'),
])
def test_post_preserves_response_limits(monkeypatch, body, content_type, message):
    monkeypatch.setattr(connectors, "MAX_RESPONSE_BYTES", 1024)
    mock_http(monkeypatch, lambda request: httpx.Response(
        200, content=body, headers={"content-type": content_type},
    ))
    with pytest.raises(connectors.ConnectorError, match=message):
        asyncio.run(connectors.safe_post_json("https://app.dimensions.ai/api/auth", json_body={"key": "key"}))


def test_dimensions_reports_query_errors(monkeypatch):
    mock_http(monkeypatch, lambda request: httpx.Response(200, json=(
        {"token": "token"} if request.url.path == "/api/auth"
        else {"errors": {"query": "private provider detail"}}
    )))
    with pytest.raises(connectors.ConnectorError, match="execute the search"):
        asyncio.run(connectors.search_dimensions("term", {}, 5, "key"))
