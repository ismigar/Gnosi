"""Discovery ordering, malformed native operations and unvalidated field values."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from backend.domains.mail.connectors import drupal
from backend.tests.test_drupal_connector_http_contract import RawResponse, install_responses


def test_content_types_stable_order_and_raw_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    identifier = [7]
    install_responses(
        monkeypatch,
        RawResponse(
            {
                "data": [
                    {"id": "z", "attributes": {"drupal_internal__type": "z", "name": "Zulu"}},
                    {
                        "id": identifier,
                        "attributes": {"drupal_internal__type": [1], "name": "alpha"},
                    },
                    {"id": "second", "attributes": {"drupal_internal__type": "a", "name": "ALPHA"}},
                    {"attributes": {"drupal_internal__type": 0}},
                ]
            }
        ),
    )
    result = asyncio.run(drupal.list_content_types())
    assert [row["label"] for row in result] == ["alpha", "ALPHA", "Zulu"]
    assert result[0]["uuid"] is identifier
    assert result[0]["machine"] == [1]


@pytest.mark.parametrize(
    "document,error,message",
    [
        (None, AttributeError, "'NoneType' object has no attribute 'get'"),
        ([], AttributeError, "'list' object has no attribute 'get'"),
        ({"data": None}, TypeError, "'NoneType' object is not iterable"),
        ({"data": [1]}, AttributeError, "'int' object has no attribute 'get'"),
        (
            {"data": [{"attributes": None}]},
            AttributeError,
            "'NoneType' object has no attribute 'get'",
        ),
        (
            {"data": [{"attributes": {"drupal_internal__type": 4}}]},
            AttributeError,
            "'int' object has no attribute 'lower'",
        ),
    ],
)
def test_content_types_native_failures(
    monkeypatch: pytest.MonkeyPatch, document: object, error: type[Exception], message: str
) -> None:
    install_responses(monkeypatch, RawResponse(document))
    with pytest.raises(error) as caught:
        asyncio.run(drupal.list_content_types())
    assert str(caught.value) == message


def test_config_pagination_order_duplicates_and_raw_labels(monkeypatch: pytest.MonkeyPatch) -> None:
    raw_label = {"unvalidated": True}
    raw_bundles = [2, "tags", "tags"]
    first = {
        "data": [
            {"attributes": {"bundle": "article", "field_name": "title"}},
            {"attributes": {"bundle": "other", "field_name": "field_skip"}},
            {
                "attributes": {
                    "bundle": "article",
                    "field_name": "field_z",
                    "label": raw_label,
                    "settings": {"handler_settings": {"target_bundles": raw_bundles}},
                }
            },
        ],
        "links": {"next": {"href": "/page2"}},
    }
    second = {
        "data": [
            {"attributes": {"bundle": "article", "field_name": "field_z", "label": "duplicate"}},
            {"attributes": {"bundle": "article", "field_name": 42, "field_type": ["raw"]}},
        ]
    }
    requests = install_responses(monkeypatch, RawResponse(first), RawResponse(second))
    result = asyncio.run(drupal.list_fields("article"))
    assert [row["field_name"] for row in result] == ["title", "field_z", 42]
    assert result[1]["label"] is raw_label
    assert result[1]["target_bundles"] is raw_bundles
    assert result[2]["field_type"] == ["raw"]
    assert requests[1].url.path == "/page2"
    assert len(requests) == 2


@pytest.mark.parametrize(
    "value,error",
    [
        (None, AttributeError),
        ([], AttributeError),
        ({"data": None}, TypeError),
        ({"data": [{"attributes": {"bundle": "article", "field_name": [1]}}]}, TypeError),
        ({"links": None}, AttributeError),
        ({"links": {"next": "bad"}}, AttributeError),
    ],
)
def test_config_errors_are_not_swallowed(
    monkeypatch: pytest.MonkeyPatch, value: object, error: type[Exception]
) -> None:
    requests = install_responses(monkeypatch, RawResponse(value))
    with pytest.raises(error):
        asyncio.run(drupal.list_fields("article"))
    assert len(requests) == 1


def test_fallback_attribute_then_relationship_order_and_all_node_targets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = {
        "attributes": {"body": "", "field_z": "z", "field_a": "a"},
        "relationships": {
            "field_tags": {"data": None},
            "field_image": {"data": {"type": "file--file"}},
            "uid": {"data": {"type": "user--user"}},
        },
    }
    second = {
        "relationships": {
            "field_tags": {
                "data": [
                    {"type": "taxonomy_term--z"},
                    {"type": "taxonomy_term--a"},
                    {"type": "taxonomy_term--a"},
                ]
            }
        }
    }
    requests = install_responses(
        monkeypatch, RawResponse({}), RawResponse({"data": [first, second]})
    )
    result = asyncio.run(drupal.list_fields("article"))
    assert [row["field_name"] for row in result] == [
        "title",
        "body",
        "field_z",
        "field_a",
        "field_tags",
        "field_image",
    ]
    assert result[4]["target_bundles"] == ["a", "z"]
    assert result[5]["target_bundles"] == ["file"]
    assert requests[1].url.params["page[limit]"] == "50"


@pytest.mark.parametrize(
    "response",
    [
        RawResponse({"data": [None]}),
        RawResponse({"data": [1]}),
        RawResponse({"data": [{"relationships": {"field_bad": {"data": {"type": 4}}}}]}),
        httpx.Response(200, text="bad JSON"),
        httpx.Response(500),
    ],
)
def test_fallback_errors_keep_title(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> None:
    install_responses(monkeypatch, RawResponse({}), response)
    assert asyncio.run(drupal.list_fields("article")) == [
        {"field_name": "title", "label": "Títol", "field_type": "string"},
    ]


def test_fallback_partial_append_is_not_rolled_back(monkeypatch: pytest.MonkeyPatch) -> None:
    install_responses(
        monkeypatch,
        RawResponse({}),
        RawResponse(
            {
                "data": [
                    {
                        "attributes": {"body": "", "field_ok": 1, 5: "bad key"},
                    }
                ]
            }
        ),
    )
    result = asyncio.run(drupal.list_fields("article"))
    assert [row["field_name"] for row in result] == ["title", "body", "field_ok"]


def test_title_search_preserves_order_opaque_ids_and_ignores_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw_title = "  Àlpha, BETA!  "
    raw_id = {"opaque": 3}
    requests = install_responses(
        monkeypatch,
        RawResponse(
            {
                "data": [
                    {"id": raw_id, "attributes": {"title": raw_title, "drupal_internal__nid": [3]}},
                    {"id": "longer", "attributes": {"title": "Alpha beta more"}},
                    {
                        "id": "second",
                        "attributes": {"title": "alpha beta", "path": {"alias": "/x"}},
                    },
                ]
            }
        ),
    )
    result = asyncio.run(drupal.find_nodes_by_title("article", " Àlpha beta ", limit=1))
    assert len(result) == 2
    assert result[0]["uuid"] is raw_id
    assert result[0]["title"] is raw_title
    assert result[0]["url"] == "https://drupal.invalid/node/[3]"
    assert result[1]["url"] == "https://drupal.invalid/x"
    assert requests[0].url.params["page[limit]"] == "50"
    assert requests[0].url.params["filter[title][value]"] == "Àlpha"


@pytest.mark.parametrize("title", ["", "  ", "…!?", "---"])
def test_blank_title_does_not_open_client(monkeypatch: pytest.MonkeyPatch, title: str) -> None:
    requests = install_responses(monkeypatch)
    assert asyncio.run(drupal.find_nodes_by_title("article", title)) == []
    assert requests == []
