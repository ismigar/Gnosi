"""Native duck operations remain open, without early shape validation."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator

import httpx
import pytest

from backend.domains.mail.connectors import drupal
from backend.tests.test_drupal_connector_http_contract import RawResponse, install_responses


class DuckRecord:
    def __init__(self, values: dict[object, object]) -> None:
        self.values = values
        self.calls: list[tuple[object, ...]] = []

    def get(self, key: object, *defaults: object) -> object:
        self.calls.append((key, *defaults))
        return self.values.get(key, defaults[0] if defaults else None)


class DuckLabel:
    def __init__(self, rank: int) -> None:
        self.rank = rank

    def lower(self) -> object:
        return self.rank


def test_get_default_arity_and_nonstring_lower_result(monkeypatch: pytest.MonkeyPatch) -> None:
    label = DuckLabel(3)
    attributes = DuckRecord({"drupal_internal__type": ["raw"], "name": label})
    row = DuckRecord({"attributes": attributes, "id": 9})
    document = DuckRecord({"data": [row]})
    install_responses(monkeypatch, RawResponse(document))
    result = asyncio.run(drupal.list_content_types())
    assert result[0]["label"] is label
    assert document.calls == [("data", [])]
    assert row.calls == [("attributes", {}), ("id",)]
    assert attributes.calls == [("drupal_internal__type",), ("name",)]


def test_legacy_getitem_sequence_remains_iterable(monkeypatch: pytest.MonkeyPatch) -> None:
    class Sequence:
        def __getitem__(self, index: int) -> object:
            if index == 0:
                return {"attributes": {"drupal_internal__type": "article"}}
            raise IndexError

    install_responses(monkeypatch, RawResponse({"data": Sequence()}))
    assert asyncio.run(drupal.list_content_types())[0]["machine"] == "article"


@pytest.mark.parametrize("bundles", [{2: "value", "tags": 3}, [2, "tags", "tags"], None, 3])
def test_target_bundle_existing_narrowing_and_list_identity(bundles: object) -> None:
    attributes = {"settings": {"handler_settings": {"target_bundles": bundles}}}
    result = drupal._target_bundles(attributes)
    if isinstance(bundles, list):
        assert result is bundles
    elif isinstance(bundles, dict):
        assert result == list(bundles)
    else:
        assert result == []


def test_config_seen_changes_before_later_get_failure() -> None:
    class Record:
        def get(self, key: object, default: object = None) -> object:
            if key == "field_name":
                return 7
            if key == "bundle":
                return "article"
            raise RuntimeError("late label")

    fields: list[dict[str, object]] = []
    seen: set[object] = set()
    with pytest.raises(RuntimeError, match="late label"):
        drupal._append_config_fields(fields, seen, {"data": [{"attributes": Record()}]}, "article")
    assert seen == {7}
    assert fields == []


def test_reference_type_split_keeps_opaque_target() -> None:
    class Resource:
        def __contains__(self, key: object) -> bool:
            assert key == "--"
            return True

        def split(self, separator: str, maximum: int) -> object:
            assert (separator, maximum) == ("--", 1)
            return ["taxonomy", 23]

    nodes = [{"relationships": {"field_tags": {"data": {"type": Resource()}}}}]
    assert drupal._reference_targets(nodes) == {"field_tags": {23}}


def test_pagination_passes_opaque_url_to_client_without_conversion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker = object()
    calls: list[object] = []

    class Client:
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *args: object) -> None:
            pass

        async def get(self, url: object) -> httpx.Response:
            calls.append(url)
            if len(calls) == 1:
                return RawResponse(
                    {
                        "data": [
                            {
                                "attributes": {
                                    "bundle": "article",
                                    "field_name": "field_ok",
                                }
                            }
                        ],
                        "links": {"next": {"href": marker}},
                    }
                )
            return RawResponse({})

    monkeypatch.setattr(drupal, "_client", Client)
    asyncio.run(drupal.list_fields("article"))
    assert calls[1] is marker


def test_native_relationship_items_unpack_error() -> None:
    class Relationships:
        def items(self) -> Iterator[object]:
            yield ["field_bad"]

    with pytest.raises(ValueError, match="not enough values to unpack \\(expected 2, got 1\\)"):
        drupal._reference_targets([{"relationships": Relationships()}])


@pytest.mark.parametrize("identifier", [None, False, 0, "", [], {}])
def test_cached_term_falsy_values_are_returned_without_request(
    monkeypatch: pytest.MonkeyPatch,
    identifier: object,
) -> None:
    requests = install_responses(monkeypatch)
    assert (
        asyncio.run(drupal.resolve_or_create_term("tags", "cached", cache={"cached": identifier}))
        is identifier
    )
    assert requests == []


def test_file_first_matching_falsy_id_is_not_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    identifier: list[object] = []
    install_responses(
        monkeypatch,
        RawResponse(
            {
                "data": [
                    {"id": identifier},
                    {"id": "later"},
                ]
            }
        ),
    )
    assert asyncio.run(drupal.find_existing_file("file")) is identifier


def test_discovery_calls_custom_iterator_once(monkeypatch: pytest.MonkeyPatch) -> None:
    class Rows:
        def __init__(self) -> None:
            self.calls = 0
            self.values = iter([{"attributes": {"drupal_internal__type": "article"}}])

        def __iter__(self) -> Rows:
            self.calls += 1
            return self

        def __next__(self) -> object:
            return next(self.values)

    rows = Rows()
    install_responses(monkeypatch, RawResponse({"data": rows}))
    assert asyncio.run(drupal.list_content_types())[0]["machine"] == "article"
    assert rows.calls == 1


def test_items_lookup_stopiteration_keeps_original_exception() -> None:
    class Relationships:
        def items(self) -> object:
            raise StopIteration("native items")

    with pytest.raises(StopIteration, match="native items"):
        drupal._reference_targets([{"relationships": Relationships()}])
