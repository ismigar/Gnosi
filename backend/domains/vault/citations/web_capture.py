"""Read-only Zotero translation-server web capture orchestration."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import cast


Metadata = dict[str, object]
CaptureResponse = dict[str, object]


@dataclass(frozen=True)
class WebCaptureDependencies:
    """Translation-server transport and reference mapping ports."""

    server_url: Callable[[], str]
    post_web: Callable[[str, str, str], tuple[int | None, str | None]]
    map_zotero_item: Callable[[Metadata], Metadata]
    inject_citation_key: Callable[[Metadata], Metadata]
    normalize_item_type: Callable[[Metadata], Metadata]


def _selection_request(body: str) -> str | None:
    try:
        parsed = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    raw_items = parsed.get("items")
    if not isinstance(raw_items, dict):
        return None
    selected = dict(list(raw_items.items())[:50])
    if not selected:
        return None
    return json.dumps({"items": selected, "session": parsed.get("session")})


def _mapped_items(body: str, dependencies: WebCaptureDependencies) -> list[Metadata]:
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    items = [
        dependencies.map_zotero_item(cast(Metadata, item))
        for item in parsed
        if isinstance(item, dict)
    ]
    return [item for item in items if item]


async def capture_url(
    payload: Mapping[str, object],
    dependencies: WebCaptureDependencies,
) -> CaptureResponse:
    """Capture one URL and return the established lookup-compatible response."""
    url = cast(str, payload.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        return {
            "source": "web",
            "identifier": url,
            "suggested": {},
            "error": "URL no vàlida",
        }
    server_url = dependencies.server_url().rstrip("/")
    status, body = await asyncio.to_thread(
        dependencies.post_web,
        server_url,
        url,
        "text/plain",
    )
    if status is None:
        return {
            "source": "web",
            "identifier": url,
            "suggested": {},
            "error": "El servei de captura web (translation-server) no està disponible",
        }
    if status == 300 and body:
        selection = _selection_request(body)
        if selection:
            status, body = await asyncio.to_thread(
                dependencies.post_web,
                server_url,
                selection,
                "application/json",
            )
    items = _mapped_items(body, dependencies) if status == 200 and body else []
    if not items:
        return {
            "source": "web",
            "identifier": url,
            "suggested": {},
            "error": "Could not extract any reference from the URL",
        }
    suggested = dependencies.normalize_item_type(dependencies.inject_citation_key(items[0]))
    if not suggested.get("URL"):
        suggested["URL"] = url
    return {
        "source": "web",
        "identifier": url,
        "suggested": suggested,
        "count": len(items),
        "error": None,
    }


__all__ = [
    "CaptureResponse",
    "Metadata",
    "WebCaptureDependencies",
    "capture_url",
]
