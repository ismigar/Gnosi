"""Compatibility-preserving request contracts for citation HTTP routes."""

from __future__ import annotations

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field, JsonValue, SkipValidation


class CitationRequest(BaseModel):
    """Named request whose values retain their raw 2.x JSON representation."""

    model_config = ConfigDict(extra="allow")

    def as_payload(self) -> dict[str, object]:
        """Return known and extension fields without coercing their values."""
        payload: dict[str, object] = {}
        for name, value in self:
            payload[name] = value
        return payload


class CitationFormattingRequest(CitationRequest):
    """Ordered citation keys and optional CSL rendering preferences."""

    keys: SkipValidation[list[JsonValue] | None] = Field(
        default=None,
        description="Ordered citation keys; duplicate keys are preserved.",
    )
    style: SkipValidation[str | None] = Field(default=None, description="CSL style identifier.")
    locale: SkipValidation[str | None] = Field(default=None, description="CSL locale identifier.")


class CitationKeyRequest(CitationRequest):
    """Bibliographic values used to generate one unique citation key."""

    authors: SkipValidation[str | list[JsonValue] | None] = None
    year: SkipValidation[int | str | None] = None
    title: SkipValidation[str | None] = None


class MetadataLookupRequest(CitationRequest):
    """Candidate identifiers, resolved in the historical provider priority."""

    doi: SkipValidation[str | None] = None
    isbn: SkipValidation[str | None] = None
    arxiv: SkipValidation[str | None] = None
    pmid: SkipValidation[str | None] = None
    url: SkipValidation[str | None] = None


class ZoteroExtraPromotionRequest(CitationRequest):
    """Selection and destination for promoting a dynamic Zotero extra field."""

    table_id: SkipValidation[str | None] = None
    zotero_field: SkipValidation[str | None] = None
    column_name: SkipValidation[str | None] = None
    column_type: SkipValidation[str | None] = None
    page_ids: SkipValidation[list[JsonValue] | None] = None
    expected_etags: SkipValidation[dict[str, JsonValue] | None] = None


def request_payload(request: CitationRequest | Mapping[str, object]) -> dict[str, object]:
    """Support FastAPI models and existing direct domain callers alike."""
    if isinstance(request, CitationRequest):
        return request.as_payload()
    return dict(request)


__all__ = [
    "CitationFormattingRequest",
    "CitationKeyRequest",
    "CitationRequest",
    "MetadataLookupRequest",
    "ZoteroExtraPromotionRequest",
    "request_payload",
]
