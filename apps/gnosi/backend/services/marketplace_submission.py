"""Optional broker client for moderated marketplace submissions."""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Mapping

import requests

from backend.agent.web_context import is_public_http_url

_MAX_RESPONSE_BYTES = 1024 * 1024


class MarketplaceSubmissionError(ValueError):
    """A marketplace submission could not be delivered to the broker."""


def configured() -> bool:
    """Return whether this deployment configured a submission broker."""

    return bool(os.environ.get("GNOSI_MARKETPLACE_SUBMISSION_URL", "").strip())


def submit_package(
    *,
    kind: str,
    filename: str,
    package: bytes,
    metadata: Mapping[str, Any],
) -> Dict[str, Any]:
    """Upload a package to a public, explicitly configured moderation broker."""

    url = os.environ.get("GNOSI_MARKETPLACE_SUBMISSION_URL", "").strip()
    if not url:
        raise MarketplaceSubmissionError("Marketplace submission service is not configured")
    ok, reason = is_public_http_url(url)
    if not ok:
        raise MarketplaceSubmissionError(f"Submission URL is not allowed: {reason}")
    headers = {"User-Agent": "Gnosi-Marketplace/1.0"}
    token = os.environ.get("GNOSI_MARKETPLACE_SUBMISSION_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        response = requests.post(
            url,
            headers=headers,
            data={"kind": kind, "metadata": json.dumps(dict(metadata), ensure_ascii=False)},
            files={"package": (filename, package, "application/zip")},
            timeout=45,
            allow_redirects=False,
            stream=True,
        )
    except requests.RequestException as exc:
        raise MarketplaceSubmissionError(f"Submission upload failed: {exc}") from exc
    try:
        if response.is_redirect:
            raise MarketplaceSubmissionError("Submission broker redirects are not allowed")
        try:
            response.raise_for_status()
        except requests.RequestException as exc:
            raise MarketplaceSubmissionError(
                f"Submission broker returned HTTP {response.status_code}"
            ) from exc
        chunks = []
        total = 0
        for chunk in response.iter_content(64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > _MAX_RESPONSE_BYTES:
                raise MarketplaceSubmissionError("Submission broker response is too large")
            chunks.append(chunk)
        raw = b"".join(chunks)
        if not raw:
            return {"status": "submitted"}
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise MarketplaceSubmissionError("Submission broker returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise MarketplaceSubmissionError("Submission broker response must be an object")
        return payload
    finally:
        response.close()
