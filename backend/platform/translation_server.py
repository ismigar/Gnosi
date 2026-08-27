"""HTTP transport adapter for the optional Zotero translation server."""

from __future__ import annotations

import logging
import urllib.error
import urllib.request


def post_web(
    base_url: str,
    body: str,
    content_type: str,
    logger: logging.Logger,
) -> tuple[int | None, str | None]:
    """Submit one web-capture request and retain HTTP error response bodies."""
    request = urllib.request.Request(
        f"{base_url}/web",
        data=body.encode("utf-8"),
        headers={"Content-Type": content_type},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as error:
        logger.warning("translation-server inaccessible: %s", error)
        return None, None


__all__ = ["post_web"]
