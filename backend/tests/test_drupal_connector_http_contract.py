"""Synthetic characterization of Drupal HTTP boundaries; no credentials or sockets."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Coroutine

import httpx
import pytest

from backend.domains.mail.connectors import drupal


class RawResponse(httpx.Response):
    """Retain the exact object supplied by a fake JSON decoder."""

    def __init__(self, value: object, status: int = 200, text: str = "raw") -> None:
        super().__init__(status, text=text)
        self.value = value
        self.reads = 0

    def json(self, **kwargs: object) -> object:
        self.reads += 1
        return self.value


def install_responses(
    monkeypatch: pytest.MonkeyPatch, *responses: httpx.Response
) -> list[httpx.Request]:
    requests: list[httpx.Request] = []
    queue = iter(responses)

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return next(queue)

    monkeypatch.setattr(
        drupal,
        "_client",
        lambda: httpx.AsyncClient(
            base_url="https://drupal.invalid", transport=httpx.MockTransport(handle)
        ),
    )
    monkeypatch.setattr(drupal, "_base_url", lambda: "https://drupal.invalid")
    return requests


def request_operation(name: str) -> Coroutine[object, object, object]:
    if name == "types":
        return drupal.list_content_types()
    if name == "fields":
        return drupal.list_fields("article")
    if name == "find":
        return drupal.find_nodes_by_title("article", "Title")
    if name == "create":
        return drupal.create_node("article", {})
    if name == "update":
        return drupal.update_node("uuid", "article", {})
    if name == "translation":
        return drupal.add_translation("uuid", "ca", {})
    if name == "upload":
        return drupal.upload_image("article", "field_image", "image.png", b"png")
    return drupal.resolve_or_create_term("tags", "term")


@pytest.mark.parametrize("operation", ["update", "translation"])
@pytest.mark.parametrize("value", [None, False, 17, "text", [], [1], {"extra": [1]}])
def test_raw_custom_response_identity(
    monkeypatch: pytest.MonkeyPatch, operation: str, value: object
) -> None:
    response = RawResponse(value)
    requests = install_responses(monkeypatch, response)
    assert asyncio.run(request_operation(operation)) is value
    assert response.reads == 1
    assert requests[0].method == "POST"
    assert requests[0].headers["accept"] == "application/json"
    assert requests[0].url.params["_format"] == "json"


@pytest.mark.parametrize(
    "operation",
    [
        "types",
        "fields",
        "find",
        "create",
        "update",
        "translation",
        "upload",
        "term",
    ],
)
@pytest.mark.parametrize("status", [404, 403, 500])
def test_http_errors_precede_json_decode(
    monkeypatch: pytest.MonkeyPatch, operation: str, status: int
) -> None:
    response = RawResponse([], status=status, text="WAF 'quoted' \"body\" " + "x" * 400)
    install_responses(monkeypatch, response)
    error = drupal.DrupalNotFound if status == 404 else drupal.DrupalSyncError
    with pytest.raises(error) as caught:
        asyncio.run(request_operation(operation))
    assert str(caught.value).endswith(response.text[: 200 if status == 404 else 300])
    assert response.reads == 0


@pytest.mark.parametrize(
    "operation",
    [
        "types",
        "fields",
        "find",
        "create",
        "update",
        "translation",
        "upload",
        "term",
    ],
)
def test_invalid_json_remains_decoder_error(
    monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    install_responses(monkeypatch, httpx.Response(200, text="<html>WAF</html>"))
    with pytest.raises(json.JSONDecodeError):
        asyncio.run(request_operation(operation))


def test_create_preserves_payload_quotes_and_opaque_values(monkeypatch: pytest.MonkeyPatch) -> None:
    opaque = {"uuid": [7]}
    title = ["original"]
    response = RawResponse(
        {
            "data": {
                "id": opaque,
                "attributes": {
                    "title": title,
                    "drupal_internal__nid": [12],
                    "path": {"alias": ["alias"]},
                },
            }
        }
    )
    requests = install_responses(monkeypatch, response)
    attributes = {"title": 'L\'autor — "text"', "langcode": "fr"}
    relationships = {"field_tags": {"data": [{"id": [1], "type": "taxonomy_term--tags"}]}}
    result = asyncio.run(drupal.create_node("article", attributes, relationships, "ca"))
    assert result["uuid"] is opaque
    assert result["title"] is title
    assert result["url"] == "https://drupal.invalid['alias']"
    assert attributes == {"title": 'L\'autor — "text"', "langcode": "fr"}
    request = requests[0]
    assert request.method == "POST"
    assert request.url.path == "/jsonapi/node/article"
    assert request.headers["content-type"] == drupal.JSONAPI
    assert json.loads(request.content) == {
        "data": {
            "type": "node--article",
            "attributes": attributes,
            "relationships": relationships,
        }
    }


def test_upload_ascii_filename_binary_and_opaque_id(monkeypatch: pytest.MonkeyPatch) -> None:
    identifier = ["raw", 9]
    requests = install_responses(monkeypatch, RawResponse({"data": {"id": identifier}}))
    result = asyncio.run(
        drupal.upload_image("article", "field_image", 'García "x".png', b"\x00\xff")
    )
    assert result is identifier
    assert requests[0].method == "POST"
    assert requests[0].content == b"\x00\xff"
    assert requests[0].headers["content-disposition"] == 'file; filename="Garcia "x".png"'


@pytest.mark.parametrize("identifier", [None, False, 0, "", [], {}])
def test_upload_missing_falsy_id_retains_error(
    monkeypatch: pytest.MonkeyPatch, identifier: object
) -> None:
    install_responses(monkeypatch, RawResponse({"data": {"id": identifier}}, text="no UUID"))
    with pytest.raises(drupal.DrupalSyncError, match="response has no file UUID \\(no UUID\\)"):
        asyncio.run(drupal.upload_image("article", "field_image", "file", b""))


@pytest.mark.parametrize(
    "document,error",
    [
        (None, AttributeError),
        ([], AttributeError),
        ({"data": None}, AttributeError),
        ({"data": []}, AttributeError),
        ({"data": {"attributes": None}}, AttributeError),
        ({"data": {"attributes": {"path": [1]}}}, AttributeError),
    ],
)
def test_create_malformed_documents_preserve_native_errors(
    monkeypatch: pytest.MonkeyPatch, document: object, error: type[Exception]
) -> None:
    install_responses(monkeypatch, RawResponse(document))
    with pytest.raises(error):
        asyncio.run(drupal.create_node("article", {}))


@pytest.mark.parametrize("create", [False, True])
def test_term_cache_and_opaque_id(monkeypatch: pytest.MonkeyPatch, create: bool) -> None:
    identifier = {"id": [23]}
    response = RawResponse({"data": {"id": identifier}})
    requests = install_responses(
        monkeypatch, RawResponse({"data": [] if create else [{"id": identifier}]}), response
    )
    cache: dict[str, object] = {}
    assert (
        asyncio.run(drupal.resolve_or_create_term("tags", '  O\'Neil "quoted"  ', cache=cache))
        is identifier
    )
    assert cache == {'O\'Neil "quoted"': identifier}
    assert (
        asyncio.run(drupal.resolve_or_create_term("tags", 'O\'Neil "quoted"', cache=cache))
        is identifier
    )
    assert [request.method for request in requests] == (["GET", "POST"] if create else ["GET"])
    if create:
        assert json.loads(requests[1].content)["data"]["attributes"]["name"] == 'O\'Neil "quoted"'


def test_find_file_preserves_order_filter_and_raw_id(monkeypatch: pytest.MonkeyPatch) -> None:
    identifier = {"opaque": 1}
    requests = install_responses(
        monkeypatch,
        RawResponse(
            {
                "data": [
                    {"id": "wrong-size", "attributes": {"filesize": 1}},
                    {"id": identifier, "attributes": {"filesize": 9}},
                    {"id": "later", "attributes": {"filesize": 9}},
                ]
            }
        ),
    )
    assert asyncio.run(drupal.find_existing_file("García.png", 9)) is identifier
    params = requests[0].url.params
    assert params["sort"] == "drupal_internal__fid"
    assert params["filter[filename]"] == "Garcia.png"
    assert params["filter[status]"] == "1"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="bad"),
        httpx.Response(200, text="invalid JSON"),
        RawResponse({"data": None}),
        RawResponse({"data": [4]}),
        RawResponse(None),
    ],
)
def test_find_file_best_effort_remains_none(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> None:
    install_responses(monkeypatch, response)
    assert asyncio.run(drupal.find_existing_file("file", 4)) is None
