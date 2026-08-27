"""Safe external-link preview HTTP adapter."""

from __future__ import annotations

import asyncio
import html
import re
from collections.abc import Callable
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException

from backend.domains.vault.links.api.dependencies import LinkApiDependencies


async def _fetch_preview_response(
    raw: str,
    dependencies: LinkApiDependencies,
) -> tuple[httpx.Response, str]:
    async with httpx.AsyncClient(follow_redirects=False, timeout=8.0) as client:
        current = raw
        response: httpx.Response | None = None
        for _hop in range(6):
            ok, reason = await asyncio.to_thread(
                dependencies.is_safe_external_url,
                current,
            )
            if not ok:
                raise HTTPException(
                    status_code=400,
                    detail=f"URL not allowed: {reason}",
                )
            response = await client.get(
                current,
                headers={"User-Agent": "Mozilla/5.0 (compatible; GnosiBot/1.0)"},
            )
            location = response.headers.get("location")
            if response.is_redirect and location:
                current = str(response.url.join(location))
                continue
            break
        else:
            raise HTTPException(status_code=400, detail="Too many redirects")
        if response is None:
            raise HTTPException(status_code=502, detail="Could not fetch the URL")
        return response, current


def _metadata_value(text: str, *names: str) -> str:
    for name in names:
        match = re.search(
            r'<meta[^>]+(?:property|name)\s*=\s*["\']'
            + re.escape(name)
            + r'["\'][^>]*?content\s*=\s*["\']([^"\']*)["\']',
            text,
            re.IGNORECASE,
        )
        if not match:
            match = re.search(
                r'<meta[^>]+content\s*=\s*["\']([^"\']*)["\'][^>]*?'
                r'(?:property|name)\s*=\s*["\']' + re.escape(name) + r'["\']',
                text,
                re.IGNORECASE,
            )
        if match:
            return html.unescape(match.group(1)).strip()
    return ""


def _html_preview_payload(
    raw: str,
    host: str,
    text: str,
    final_url: str,
) -> dict[str, str]:
    title = _metadata_value(text, "og:title", "twitter:title")
    if not title:
        title_match = re.search(
            r"<title[^>]*>(.*?)</title>",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        title = html.unescape(title_match.group(1)).strip() if title_match else host
    description = _metadata_value(
        text,
        "og:description",
        "twitter:description",
        "description",
    )
    image = _metadata_value(text, "og:image", "twitter:image", "og:image:url")
    site_name = _metadata_value(text, "og:site_name") or host
    if image:
        image = urljoin(final_url, image)
    return {
        "url": raw,
        "title": title[:300],
        "description": description[:500],
        "image": image,
        "site_name": site_name[:120],
        "favicon": urljoin(final_url, "/favicon.ico"),
    }


def register_route(
    router: APIRouter,
    dependencies: LinkApiDependencies,
) -> Callable[..., object]:
    async def get_link_preview(url: str) -> dict[str, str]:
        """Extracts Open Graph metadata from a URL for a preview card.

        Returns `{url, title, description, image, site_name, favicon}`. Intended for
        links pasted into the body of a note (Notion bookmark style). Basic
        security: only http/https, short timeout, limited download size, and it does not
        follow internal schemes. Not a complete SSRF proxy — for local personal use.
        """
        raw = str(url or "").strip()
        parsed = urlparse(raw)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(status_code=400, detail="Invalid http/https URL")
        host = (parsed.hostname or "").lower()
        try:
            response, final_url = await _fetch_preview_response(raw, dependencies)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not fetch the URL: {exc}",
            ) from exc
        content_type = response.headers.get("content-type", "")
        if "html" not in content_type and "xml" not in content_type:
            return {
                "url": raw,
                "title": parsed.path.rsplit("/", 1)[-1] or host,
                "description": "",
                "image": "",
                "site_name": host,
                "favicon": "",
            }
        return _html_preview_payload(
            raw,
            host,
            response.text[:600_000],
            final_url,
        )

    router.add_api_route(
        "/link-preview",
        get_link_preview,
        methods=["GET"],
        response_model=None,
    )
    return get_link_preview


__all__ = ["register_route"]
