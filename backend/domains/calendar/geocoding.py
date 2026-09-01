"""Provider-neutral Photon address lookup for Calendar."""

from __future__ import annotations

import logging
from typing import Any, Mapping

import httpx

log = logging.getLogger(__name__)


def photon_label(properties: Mapping[str, Any]) -> str:
    """Build a human-readable address label from Photon properties."""

    name = properties.get("name")
    house = properties.get("housenumber")
    street = properties.get("street")
    postcode = properties.get("postcode")
    city = (
        properties.get("city")
        or properties.get("town")
        or properties.get("village")
        or properties.get("county")
    )
    state = properties.get("state")
    country = properties.get("country")

    line1_parts: list[str] = []
    if name:
        line1_parts.append(str(name))
    if street:
        line1_parts.append(f"{street}, {house}" if house else str(street))
    elif house and not name:
        line1_parts.append(str(house))

    locality = " ".join(str(part) for part in (postcode, city) if part)
    segments: list[str] = []
    if line1_parts:
        segments.append(", ".join(line1_parts))
    if locality:
        segments.append(locality)
    if state and state != city:
        segments.append(str(state))
    if country:
        segments.append(str(country))

    deduped: list[str] = []
    for segment in segments:
        if segment and (not deduped or deduped[-1] != segment):
            deduped.append(segment)
    return ", ".join(deduped)


async def search_photon(query: str) -> list[dict[str, Any]]:
    """Return at most six contained Photon address suggestions."""

    normalized = query.strip()
    if not normalized or normalized.lower().startswith(("http://", "https://", "www.")):
        return []
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.get(
                "https://photon.komoot.io/api/",
                params={"q": normalized, "limit": 6},
                headers={"User-Agent": "Gnosi-Calendar/1.0 (self-hosted personal use)"},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        log.warning("Photon geocoding failed for %r: %s", normalized, exc)
        return []

    features = payload.get("features", []) if isinstance(payload, dict) else []
    if not isinstance(features, list):
        return []
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        geometry = feature.get("geometry")
        if not isinstance(properties, dict) or not isinstance(geometry, dict):
            continue
        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            continue
        label = photon_label(properties)
        if not label or label in seen:
            continue
        seen.add(label)
        results.append({"label": label, "lat": coordinates[1], "lon": coordinates[0]})
        if len(results) >= 6:
            break
    return results


__all__ = ["photon_label", "search_photon"]
