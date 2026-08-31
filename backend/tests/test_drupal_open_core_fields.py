"""Synthetic baseline for open Drupal metadata, field order and native failures."""

from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from backend.domains.vault.drupal import core, fields


class LegacySequence:
    def __init__(self, values: list[object]) -> None:
        self.values = values
        self.indices: list[int] = []

    def __getitem__(self, index: int) -> object:
        self.indices.append(index)
        return self.values[index]


class Opaque:
    def __str__(self) -> str:
        raise AssertionError("unexpected stringification")


def test_properties_keep_identity_alias_precedence_and_legacy_iteration() -> None:
    opaque = Opaque()
    first = {"id": 7, "name": "Same", 11: opaque}
    second = {"id": "Same", "name": "Other"}
    props = LegacySequence([None, first, second])
    result = core.props_by_ref({"properties": props})
    assert result["7"] is first
    assert result["Same"] is second and result["Other"] is second
    assert result["7"][11] is opaque
    assert props.indices == [0, 1, 2, 3]
    assert core.find_column({"properties": (None, first)}, " same ") is first


@pytest.mark.parametrize(
    "function", [core.props_by_ref, lambda table: core.find_column(table, "x")]
)
def test_properties_retain_native_iteration_error(function) -> None:
    with pytest.raises(TypeError, match="'int' object is not iterable"):
        function({"properties": 7})


@pytest.mark.parametrize("empty", [None, "", [], {}])
def test_property_read_keeps_fallback_and_opaque_value(empty: object) -> None:
    opaque = Opaque()
    metadata = {"title": empty, "stable": opaque, "Display": "last", 8: opaque}
    assert (
        core.read_prop_value(metadata, {"type": "title", "id": "stable", "name": "Display"})
        is opaque
    )
    assert core.read_prop_value(metadata, None) is None
    assert metadata[8] is opaque


def test_identity_metadata_keeps_raw_uuid_url_and_visible_column_behavior() -> None:
    uuid, url = Opaque(), Opaque()
    table = {"properties": [{"id": 9, "name": "Drupal NID"}, {"name": "Drupal URL"}]}
    result = core.identity_metadata(table, uuid, 17, url)
    assert result == {
        "drupal_uuid": uuid,
        "drupal_nid": "17",
        "drupal_url": url,
        "9": "17",
        "Drupal URL": url,
    }
    assert result["drupal_uuid"] is uuid and result["Drupal URL"] is url


@pytest.mark.parametrize(
    "value,kind,expected",
    [
        ("2.8", "integer", 2),
        ("nan", "integer", None),
        (object(), "integer", None),
        ([None, "", 0, False, "a"], None, "0, False, a"),
    ],
)
def test_scalar_coercion_preserves_conversions(
    value: object, kind: str | None, expected: object
) -> None:
    assert core.coerce_scalar(value, kind) == expected


def test_integer_overflow_is_not_swallowed() -> None:
    with pytest.raises(OverflowError):
        core.coerce_scalar("inf", "integer")


class SyncError(Exception):
    pass


def field_dependencies(events: list[object]) -> fields.DrupalFieldDependencies:
    async def term(vocabulary: str, name: str, cache: dict[str, str]) -> str:
        events.append(("term", vocabulary, name, cache))
        if name == "bad":
            raise SyncError("term failed")
        return name

    async def upload(value, bundle, field, metadata, cache):
        events.append(("image", value, bundle, field, metadata, cache))
        raise ValueError("upload failed")

    def html(text: str, cache: dict[str, str | None]) -> str:
        events.append(("html", text, cache))
        return f"<p>{text}</p>"

    return fields.DrupalFieldDependencies(
        sync_error=SyncError,
        markdown_to_html=html,
        read_prop_value=core.read_prop_value,
        upload_field_image=upload,
        resolve_or_create_term=term,
        coerce_scalar=core.coerce_scalar,
    )


def run_fields(dependencies, *, mapping=None, metadata=None, field_metadata=None, **options):
    return asyncio.run(
        fields.build_fields(
            mapping=mapping
            if mapping is not None
            else {
                core.DRUPAL_BODY_REF: "body",
                "tags": "tags",
                "image": "image",
                "number": "number",
            },
            properties_by_ref={key: {"id": key} for key in ("tags", "image", "number")},
            field_metadata=field_metadata
            if field_metadata is not None
            else {
                "tags": {"type": "entity_reference", "vocab": "topics"},
                "image": {"type": "image"},
                "number": {"type": "integer"},
            },
            metadata=metadata
            if metadata is not None
            else {"tags": ["A", "bad", "A", " "], "image": Opaque(), "number": "3.5"},
            body="Body",
            bundle="article",
            term_cache={},
            image_cache={},
            dependencies=dependencies,
            **options,
        )
    )


@pytest.mark.parametrize(
    "text_only,media_only,event_names",
    [
        (False, False, ["html", "term", "term", "term", "image"]),
        (True, False, ["html"]),
        (False, True, ["term", "term", "term", "image"]),
        (True, True, []),
    ],
)
def test_field_modes_order_duplicates_and_caught_errors(text_only, media_only, event_names) -> None:
    events: list[object] = []
    attributes, relationships, skipped = run_fields(
        field_dependencies(events), text_only=text_only, media_only=media_only
    )
    assert [event[0] for event in events] == event_names
    assert attributes == (
        {} if media_only else {"body": {"value": "<p>Body</p>", "format": "full_html"}, "number": 3}
    )
    if text_only:
        assert relationships == {} and skipped == []
    else:
        assert relationships["tags"]["data"] == [{"type": "taxonomy_term--topics", "id": "A"}] * 2
        assert skipped == [
            {"field": "tags", "value": "bad", "reason": "term failed"},
            {"field": "image", "reason": "image: upload failed"},
        ]


def test_callback_result_identity_and_no_opaque_stringification() -> None:
    events: list[object] = []
    opaque = Opaque()
    relationship = {"data": opaque}
    metadata = {"image": opaque, 19: opaque}

    async def upload(value, bundle, field, actual_metadata, cache):
        assert value is opaque and actual_metadata is metadata
        return relationship

    dependencies = replace(field_dependencies(events), upload_field_image=upload)
    _, relationships, skipped = run_fields(
        dependencies, mapping={"image": "image"}, metadata=metadata
    )
    assert relationships["image"] is relationship and skipped == []


def test_uncaptured_taxonomy_exception_stops_before_image() -> None:
    events: list[object] = []
    error = ValueError("not a sync error")

    async def term(vocabulary, name, cache):
        raise error

    dependencies = replace(field_dependencies(events), resolve_or_create_term=term)
    with pytest.raises(ValueError) as caught:
        run_fields(dependencies)
    assert caught.value is error and [event[0] for event in events] == ["html"]


def test_raw_mapping_uses_native_items_and_unpacking() -> None:
    class MappingValue:
        def items(self):
            return LegacySequence([("number", "number")])

    assert run_fields(field_dependencies([]), mapping=MappingValue())[0] == {"number": 3}
    with pytest.raises(AttributeError, match="'list' object has no attribute 'items'"):
        run_fields(field_dependencies([]), mapping=[])

    class BadPairs:
        def items(self):
            return [("number", "number", "extra")]

    with pytest.raises(ValueError, match="too many values to unpack"):
        run_fields(field_dependencies([]), mapping=BadPairs())


def test_malformed_field_config_fails_before_callback() -> None:
    events: list[object] = []
    with pytest.raises(AttributeError, match="'int' object has no attribute 'get'"):
        run_fields(
            field_dependencies(events), mapping={"number": "number"}, field_metadata={"number": 7}
        )
    assert events == []


def test_taxonomy_ids_and_scalar_callback_results_retain_identity() -> None:
    opaque = Opaque()

    async def term(vocabulary, name, cache):
        cache[name] = opaque
        return opaque

    dependencies = replace(
        field_dependencies([]),
        resolve_or_create_term=term,
        coerce_scalar=lambda value, kind: opaque,
    )
    attributes, relationships, skipped = run_fields(
        dependencies, mapping={"tags": "tags", "number": "number"}
    )
    assert attributes["number"] is opaque
    assert all(item["id"] is opaque for item in relationships["tags"]["data"])
    assert skipped == []


def test_native_items_is_called_once_and_preserves_pair_iterator_protocol() -> None:
    events: list[object] = []

    class Pair:
        def __iter__(self):
            events.append("pair.iter")
            return iter(("number", "number"))

    class MappingValue:
        def items(self):
            events.append("items")
            return [Pair()]

    assert run_fields(field_dependencies([]), mapping=MappingValue())[0] == {"number": 3}
    assert events == ["items", "pair.iter"]
