"""Focused compatibility checks for named citation request bodies."""

from __future__ import annotations

import pytest

from backend.domains.vault.citations.request_contracts import (
    CitationFormattingRequest,
    CitationKeyRequest,
    CitationRequest,
    MetadataLookupRequest,
    ZoteroExtraPromotionRequest,
    request_payload,
)


@pytest.mark.parametrize(
    ("model", "payload", "properties"),
    [
        (
            CitationFormattingRequest,
            {"keys": "legacy-invalid", "style": 7, "locale": False},
            {"keys", "style", "locale"},
        ),
        (
            CitationKeyRequest,
            {"authors": {"legacy": True}, "year": [2026], "title": 4},
            {"authors", "year", "title"},
        ),
        (
            MetadataLookupRequest,
            {"doi": 1, "isbn": [], "arxiv": {}, "pmid": False, "url": 9},
            {"doi", "isbn", "arxiv", "pmid", "url"},
        ),
        (
            ZoteroExtraPromotionRequest,
            {
                "table_id": 1,
                "zotero_field": [],
                "column_name": False,
                "column_type": {},
                "page_ids": "legacy-invalid",
                "expected_etags": [],
            },
            {
                "table_id",
                "zotero_field",
                "column_name",
                "column_type",
                "page_ids",
                "expected_etags",
            },
        ),
    ],
)
def test_request_models_declare_fields_without_coercing_legacy_json(
    model: type[CitationRequest],
    payload: dict[str, object],
    properties: set[str],
) -> None:
    extension = {"future_extension": {"nested": [1, "two", None]}}
    parsed = model.model_validate({**payload, **extension})

    assert request_payload(parsed) == {**payload, **extension}
    schema = model.model_json_schema()
    assert schema["type"] == "object"
    assert set(schema["properties"]) == properties


def test_request_payload_keeps_existing_mapping_callers() -> None:
    payload: dict[str, object] = {"doi": "10.1000/legacy", "extension": 3}

    assert request_payload(payload) == payload
    assert request_payload(payload) is not payload
