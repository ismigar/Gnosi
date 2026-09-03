"""Citation-key generation HTTP adapter."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict

from fastapi import APIRouter, Body
from pydantic import BaseModel

from backend.domains.vault.citations.keys import generate_citation_key


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
        payload: dict[str, object] = Body(...),
    ) -> CitationKeyPayload:
        """Generates a unique Citation Key for a manual entry in Recursos.

        Body: { authors?: str | list, year?: int | str, title?: str }
        Response: { "citation_key": str }

        """
        key = generate_citation_key(
            payload.get("authors"),
            payload.get("year"),
            str(payload.get("title") or ""),
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


__all__ = ["CitationKeyResponse", "register_route"]
