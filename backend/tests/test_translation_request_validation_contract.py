"""Constructor/model_validate equivalence at the unmodified HTTP schema boundary."""

from __future__ import annotations

from collections.abc import Mapping

import pytest
from pydantic import BaseModel, ValidationError

from backend.domains.vault.schemas.pages import PagePatchRequest, PageSaveRequest


@pytest.mark.parametrize("model", [PageSaveRequest, PagePatchRequest])
@pytest.mark.parametrize("metadata", [
    {}, {"key": "value"}, {"nested": {7: "allowed nested key"}},
    {"unknown": [None, 3, False, {"leaf": "value"}]},
    {7: "invalid top-level key"}, {False: "invalid boolean key"},
    {(1, 2): "invalid tuple key"}, {b"encoded": "legacy decoded key"},
    ["not a mapping"], None,
])
def test_metadata_constructor_and_model_validate_identical(
    model: type[BaseModel], metadata: object,
) -> None:
    payload: dict[str, object] = {"title": "Synthetic", "content": "Body", "metadata": metadata}
    assert_equivalent(model, payload)


@pytest.mark.parametrize("model", [PageSaveRequest, PagePatchRequest])
@pytest.mark.parametrize("payload", [
    {}, {"title": None, "content": None},
    {"title": 7, "content": 8, "parent_id": [], "metadata": {4: "invalid"}},
    {"title": "x", "content": "body", "force": "true", "is_database": "0"},
    {"title": b"x", "content": b"body", "parent_id": b"parent", "extra": "ignored"},
    {"title": "x", "content": "body", "expected_etag": None},
    {"title": "x", "content": "body", "remove_metadata_keys": [7, "name"]},
])
def test_fields_defaults_coercions_and_validation_order(
    model: type[BaseModel], payload: dict[str, object],
) -> None:
    assert_equivalent(model, payload)


def assert_equivalent(model: type[BaseModel], payload: dict[str, object]) -> None:
    try:
        constructed = model(**payload)
    except ValidationError as constructor_error:
        with pytest.raises(ValidationError) as validated_error:
            model.model_validate(payload)
        assert type(validated_error.value) is type(constructor_error)
        assert validated_error.value.errors() == constructor_error.errors()
        assert str(validated_error.value) == str(constructor_error)
        return
    validated = model.model_validate(payload)
    assert type(constructed) is type(validated) is model
    assert validated.model_dump() == constructed.model_dump()
    assert validated.model_fields_set == constructed.model_fields_set
    assert validated.__pydantic_extra__ == constructed.__pydantic_extra__
    assert validated.__pydantic_private__ == constructed.__pydantic_private__


@pytest.mark.parametrize("model", [PageSaveRequest, PagePatchRequest])
def test_nested_opaque_values_keep_identity_at_both_boundaries(model: type[BaseModel]) -> None:
    opaque = object()
    payload: dict[str, object] = {"title": "x", "content": "body", "metadata": {"extension": opaque}}
    constructed = model(**payload)
    validated = model.model_validate(payload)
    metadata: object = getattr(constructed, "metadata")
    validated_metadata: object = getattr(validated, "metadata")
    assert isinstance(metadata, Mapping) and metadata["extension"] is opaque
    assert isinstance(validated_metadata, Mapping) and validated_metadata["extension"] is opaque
