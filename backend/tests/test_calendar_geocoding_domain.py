"""Calendar geocoding domain contracts."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from backend.domains.calendar import geocoding


def test_photon_label_deduplicates_locality_segments() -> None:
    assert (
        geocoding.photon_label(
            {
                "name": "Biblioteca",
                "street": "Carrer Major",
                "housenumber": "1",
                "postcode": "08001",
                "city": "Barcelona",
                "state": "Barcelona",
                "country": "Espanya",
            }
        )
        == "Biblioteca, Carrer Major, 1, 08001 Barcelona, Espanya"
    )


def test_search_photon_rejects_urls_without_network() -> None:
    assert asyncio.run(geocoding.search_photon("https://example.test/place")) == []


def test_search_photon_normalizes_and_deduplicates_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            feature = {
                "properties": {"name": "Sala", "city": "Girona"},
                "geometry": {"coordinates": [2.82, 41.98]},
            }
            return {"features": [feature, feature]}

    class Client:
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, *_args: object, **_kwargs: object) -> Response:
            return Response()

    monkeypatch.setattr(geocoding.httpx, "AsyncClient", lambda **_kwargs: Client())

    assert asyncio.run(geocoding.search_photon("  Sala  ")) == [
        {"label": "Sala, Girona", "lat": 41.98, "lon": 2.82}
    ]
