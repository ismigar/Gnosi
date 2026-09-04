"""Citation-key generation HTTP adapter."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict

from fastapi import APIRouter
from pydantic import BaseModel

from backend.domains.vault.citations.keys import generate_citation_key
from backend.domains.vault.citations.request_contracts import CitationKeyRequest, request_payload


class CitationKeyResponse(BaseModel):
    """Unique citation key generated for one bibliographic record."""

    citation_key: str


class CitationKeyPayload(TypedDict):
    citation_key: str


def register_route(
    router: APIRouter,
    resolve_existing_keys: Callable[[], Callable[[], set[str]]],
) -> Callable[..., object]:
    async def generate_citation_key_endpoint(
        payload: CitationKeyRequest,
    ) -> CitationKeyPayload:
        """Generates a unique Citation Key for a manual entry in Recursos.

        Body: { authors?: str | list, year?: int | str, title?: str }
        Response: { "citation_key": str }

        """
        values = request_payload(payload)
        key = generate_citation_key(
            values.get("authors"),
            values.get("year"),
            str(values.get("title") or ""),
            resolve_existing_keys()(),
        )
        return {"citation_key": key}

    router.add_api_route(
        "/generate-citation-key",
        generate_citation_key_endpoint,
        methods=["POST"],
        response_model=CitationKeyResponse,
        response_model_exclude_unset=True,
    )
    return generate_citation_key_endpoint


__all__ = ["CitationKeyRequest", "CitationKeyResponse", "register_route"]
