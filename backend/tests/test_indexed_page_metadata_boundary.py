"""Internal YAML keys do not widen the public PageInfo validation schema."""

from collections.abc import Callable

import pytest
from pydantic import ValidationError, create_model

from backend.domains.vault.schemas.pages import PageInfo

LegacyPageInfo = create_model(
    "PageInfo", __base__=PageInfo, metadata=(dict[str, object], {}),
)


def _result(operation: Callable[[], PageInfo]) -> object:
    try:
        return operation().model_dump()
    except ValidationError as error:
        return error.errors(include_url=False)


@pytest.mark.parametrize("metadata", [
    {}, {"name": "Synthetic"}, {"nested": {7: [None, {"extra": True}]}},
    {7: "numeric key"}, {b"name": "bytes key"}, None, [], [1], "scalar",
])
@pytest.mark.parametrize("strict", [False, True])
def test_page_validation_matches_original_dictionary_schema(
    metadata: object, strict: bool,
) -> None:
    payload = {
        "id": "fixture", "title": "Fixture", "last_modified": "2026-08-31",
        "size": 0, "metadata": metadata,
    }
    assert _result(lambda: PageInfo.model_validate(payload, strict=strict)) == _result(
        lambda: LegacyPageInfo.model_validate(payload, strict=strict)
    )


@pytest.mark.parametrize("payload", [
    '{"id":"fixture","title":"Fixture","last_modified":"now","size":0,"metadata":{"x":1}}',
    '{"id":"fixture","title":"Fixture","last_modified":"now","size":0,"metadata":[]}',
])
def test_json_validation_and_complete_schema_are_unchanged(payload: str) -> None:
    assert _result(lambda: PageInfo.model_validate_json(payload)) == _result(
        lambda: LegacyPageInfo.model_validate_json(payload)
    )
    assert PageInfo.model_json_schema() == LegacyPageInfo.model_json_schema()


def test_index_construction_and_assignment_preserve_open_metadata_identity() -> None:
    original: dict[object, object] = {7: object()}
    page = PageInfo.model_construct(metadata=original)
    assert page.metadata is original
    replacement: dict[object, object] = {b"opaque": object()}
    page.metadata = replacement
    assert page.metadata is replacement
