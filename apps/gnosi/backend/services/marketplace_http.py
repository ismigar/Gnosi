"""Bounded public HTTP access for marketplace indexes and packages.

Marketplace URLs are controlled by administrators or remote catalog data, but
they are still untrusted. Every redirect is therefore revalidated against the
central public-network guard and response bodies are read with a strict limit.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional

import requests

from backend.agent.web_context import is_public_http_url

_REDIRECT_CODES = {301, 302, 303, 307, 308}
_USER_AGENT = "Gnosi-Marketplace/1.0 (+https://github.com/ismigar/Gnosi)"


class MarketplaceHTTPError(ValueError):
    """A marketplace request failed validation or exceeded a safety limit."""


@dataclass(frozen=True)
class PublicResponse:
    """A bounded response returned from a validated public URL."""

    body: bytes
    url: str
    status_code: int
    content_type: str


def _validated_url(url: str) -> str:
    candidate = str(url or "").strip()
    ok, reason = is_public_http_url(candidate)
    if not ok:
        raise MarketplaceHTTPError(f"Marketplace URL is not allowed: {reason}")
    return candidate


def fetch_public_bytes(
    url: str,
    *,
    max_bytes: int,
    timeout: float = 20.0,
    max_redirects: int = 4,
    headers: Optional[Mapping[str, str]] = None,
) -> PublicResponse:
    """Download bytes from public HTTP(S), validating every redirect hop."""

    current = _validated_url(url)
    request_headers = {"User-Agent": _USER_AGENT, **dict(headers or {})}
    for redirect_count in range(max_redirects + 1):
        try:
            response = requests.get(
                current,
                headers=request_headers,
                timeout=timeout,
                stream=True,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise MarketplaceHTTPError(f"Marketplace download failed: {exc}") from exc

        try:
            if response.status_code in _REDIRECT_CODES:
                location = response.headers.get("Location")
                if not location:
                    raise MarketplaceHTTPError("Marketplace redirect has no Location header")
                if redirect_count >= max_redirects:
                    raise MarketplaceHTTPError("Marketplace download has too many redirects")
                current = _validated_url(requests.compat.urljoin(current, location))
                continue

            try:
                response.raise_for_status()
            except requests.RequestException as exc:
                raise MarketplaceHTTPError(
                    f"Marketplace download returned HTTP {response.status_code}"
                ) from exc

            declared_size = response.headers.get("Content-Length")
            if declared_size:
                try:
                    if int(declared_size) > max_bytes:
                        raise MarketplaceHTTPError("Marketplace download is too large")
                except ValueError:
                    pass

            chunks = []
            total = 0
            for chunk in response.iter_content(64 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > max_bytes:
                    raise MarketplaceHTTPError("Marketplace download is too large")
                chunks.append(chunk)
            return PublicResponse(
                body=b"".join(chunks),
                url=current,
                status_code=response.status_code,
                content_type=str(response.headers.get("Content-Type") or ""),
            )
        finally:
            response.close()

    raise MarketplaceHTTPError("Marketplace download could not be completed")
