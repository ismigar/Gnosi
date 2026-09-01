"""Bounded transport, SSRF protection, and request auditing."""

from __future__ import annotations

import ipaddress
import json
import socket
from contextvars import ContextVar
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

from backend.domains.literature.connectors.runtime import current_runtime
from backend.services.literature_models import clean_text

USER_AGENT = "Gnosi-Literature/1.0 (+https://github.com/ismigar/Gnosi)"


MAX_RESPONSE_BYTES = 8 * 1024 * 1024


MAX_REDIRECTS = 3


DEFAULT_TIMEOUT_SECONDS = 20.0


CONNECTOR_AUDIT_VERSION = 1


_REQUEST_AUDIT: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "academic_request_audit",
    default=None,
)


_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "email",
    "key",
    "mailto",
    "password",
    "secret",
    "token",
}


class ConnectorError(RuntimeError):
    """A bounded, user-safe connector failure."""

    def __init__(self, message: str, *, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def begin_request_audit() -> tuple[Any, list[dict[str, Any]]]:
    """Start one task-local audit of public academic GET requests."""
    records: list[dict[str, Any]] = []
    return _REQUEST_AUDIT.set(records), records


def end_request_audit(token: Any) -> None:
    """Restore the previous request-audit context."""
    _REQUEST_AUDIT.reset(token)


def _auditable_url(raw_url: Any) -> str:
    """Return a bounded URL with credential-like query values redacted."""
    parsed = urlparse(str(raw_url or ""))
    query = urlencode(
        [
            (key, "[configured]" if key.lower() in _SENSITIVE_QUERY_KEYS else value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        ],
        doseq=True,
    )
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", query, ""))[:8_000]


def _record_request(response: httpx.Response) -> None:
    records = _REQUEST_AUDIT.get()
    if records is None or len(records) >= 100:
        return
    records.append(
        {
            "method": "GET",
            "url": _auditable_url(response.request.url),
            "status_code": response.status_code,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "connector_audit_version": CONNECTOR_AUDIT_VERSION,
        }
    )


def _is_public_address(raw: str) -> bool:
    address = ipaddress.ip_address(raw)
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def validate_public_https_url(url: str) -> str:
    """Validate HTTPS syntax and reject hostnames resolving to non-public IPs."""
    value = clean_text(url, 4_000)
    parsed = urlparse(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ConnectorError("Repository URLs must use HTTPS.")
    if parsed.username or parsed.password:
        raise ConnectorError("Repository URLs cannot contain embedded credentials.")
    if parsed.port not in (None, 443):
        raise ConnectorError("Repository URLs must use the standard HTTPS port.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ConnectorError("The repository hostname could not be resolved.") from exc
    if not addresses or any(not _is_public_address(str(item[4][0])) for item in addresses):
        raise ConnectorError("The repository hostname resolves to a blocked network address.")
    return str(value)


def _retry_after(response: httpx.Response) -> int | None:
    value = response.headers.get("retry-after", "").strip()
    if value.isdigit():
        return min(int(value), 86_400)
    if value:
        try:
            seconds = int(
                (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
            )
            return max(0, min(seconds, 86_400))
        except (TypeError, ValueError, OverflowError):
            return None
    return None


async def safe_get_bytes(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    accepted_types: tuple[str, ...] = (
        "application/json",
        "application/xml",
        "text/xml",
        "application/atom+xml",
        "text/plain",
    ),
    max_bytes: int = MAX_RESPONSE_BYTES,
) -> tuple[bytes, str, dict[str, str]]:
    """Fetch one bounded public HTTPS response with manual redirect validation."""
    runtime = current_runtime()
    current = runtime.validate_public_https_url(url)
    request_headers = {"User-Agent": runtime.USER_AGENT, "Accept": ", ".join(accepted_types)}
    request_headers.update(headers or {})
    timeout = httpx.Timeout(runtime.DEFAULT_TIMEOUT_SECONDS, connect=8.0)
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=False, trust_env=False
    ) as client:
        for redirect_count in range(runtime.MAX_REDIRECTS + 1):
            try:
                async with client.stream(
                    "GET",
                    current,
                    params=params if redirect_count == 0 else None,
                    headers=request_headers,
                ) as response:
                    runtime._record_request(response)
                    if response.status_code in {301, 302, 303, 307, 308}:
                        if redirect_count >= runtime.MAX_REDIRECTS:
                            raise ConnectorError("The repository exceeded the redirect limit.")
                        location = response.headers.get("location")
                        if not location:
                            raise ConnectorError("The repository returned an invalid redirect.")
                        current = runtime.validate_public_https_url(urljoin(current, location))
                        continue
                    if response.status_code == 429:
                        raise ConnectorError(
                            "The repository rate limit was reached.",
                            retry_after=runtime._retry_after(response),
                        )
                    if response.status_code in {401, 403}:
                        raise ConnectorError("The repository rejected the configured credentials.")
                    if response.status_code >= 400:
                        raise ConnectorError(
                            f"The repository returned HTTP {response.status_code}."
                        )
                    content_type = (
                        response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    )
                    if (
                        accepted_types
                        and content_type
                        and not any(
                            content_type == item
                            or content_type.endswith("+json")
                            or content_type.endswith("+xml")
                            for item in accepted_types
                        )
                    ):
                        raise ConnectorError(
                            f"The repository returned unsupported content type {content_type}."
                        )
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > max(1_024, min(max_bytes, runtime.MAX_RESPONSE_BYTES)):
                            raise ConnectorError("The repository response exceeded the size limit.")
                        chunks.append(chunk)
                    return b"".join(chunks), str(response.url), dict(response.headers)
            except ConnectorError:
                raise
            except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                raise ConnectorError(
                    "The repository did not respond within the safe request limits."
                ) from exc
    raise ConnectorError("The repository request did not complete.")


async def safe_get_json(url: str, **kwargs: Any) -> tuple[Any, str, dict[str, str]]:
    body, final_url, response_headers = await current_runtime().safe_get_bytes(
        url,
        accepted_types=("application/json", "text/json", "application/ld+json", "text/plain"),
        **kwargs,
    )
    try:
        return json.loads(body.decode("utf-8-sig")), final_url, response_headers
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConnectorError("The repository returned invalid JSON.") from exc
