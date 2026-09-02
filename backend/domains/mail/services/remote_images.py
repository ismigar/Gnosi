"""Ephemeral, SSRF-hardened recovery for remote mail raster images."""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import socket
import ssl
import time
import warnings
from collections import OrderedDict
from dataclasses import dataclass, replace
from io import BytesIO
from threading import Lock
from typing import AsyncIterable, AsyncIterator, Iterable, Mapping, cast
from urllib.parse import urljoin, urlparse, urlunparse

import httpcore
import httpx
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_ADDRESS_ATTEMPTS = 2
MAX_CACHE_BYTES = 32 * 1024 * 1024
MAX_CACHE_ENTRIES = 128
CACHE_TTL_SECONDS = 300.0
CACHE_STALE_IF_ERROR_SECONDS = 3600.0
MAX_REDIRECTS = 2
MAX_URL_CHARS = 4_000
TOTAL_TIMEOUT_SECONDS = 12.0

_REDIRECT_STATUSES = {301, 302, 303, 307, 308}
_MIME_BY_FORMAT = {
    "AVIF": "image/avif",
    "GIF": "image/gif",
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
_ACCEPTED_MIME_TYPES = frozenset(_MIME_BY_FORMAT.values())
_DECLARED_MIME_TYPES = {
    "": None,
    "application/octet-stream": None,
    "image/avif": "image/avif",
    "image/gif": "image/gif",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
    "image/x-png": "image/png",
}
_USER_AGENT = (
    "Mozilla/5.0 (compatible; Gnosi-Mail-Image-Recovery/1.1; "
    "+https://github.com/ismigar/Gnosi)"
)


class RemoteMailImageError(RuntimeError):
    """A safe, stable failure from the restricted image recovery path."""

    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class RemoteMailImage:
    body: bytes
    content_type: str
    etag: str = ""
    last_modified: str = ""


@dataclass(frozen=True)
class ValidatedRemoteImageUrl:
    url: str
    hostname: str
    addresses: tuple[str, ...]


@dataclass(frozen=True)
class _CachedRemoteMailImage:
    image: RemoteMailImage
    validator_url: str
    expires_at: float
    stale_until: float


@dataclass(frozen=True)
class _NotModified:
    validator_url: str


_REMOTE_IMAGE_CACHE: OrderedDict[str, _CachedRemoteMailImage] = OrderedDict()
_REMOTE_IMAGE_CACHE_BYTES = 0
_REMOTE_IMAGE_CACHE_LOCK = Lock()


def _now() -> float:
    return time.monotonic()


def _cache_key(raw_url: str) -> str:
    return hashlib.sha256(raw_url.encode("utf-8")).hexdigest()


def _clear_remote_image_cache() -> None:
    global _REMOTE_IMAGE_CACHE_BYTES
    with _REMOTE_IMAGE_CACHE_LOCK:
        _REMOTE_IMAGE_CACHE.clear()
        _REMOTE_IMAGE_CACHE_BYTES = 0


def _cached_image(raw_url: str) -> tuple[_CachedRemoteMailImage, bool] | None:
    global _REMOTE_IMAGE_CACHE_BYTES
    key = _cache_key(raw_url)
    now = _now()
    with _REMOTE_IMAGE_CACHE_LOCK:
        entry = _REMOTE_IMAGE_CACHE.pop(key, None)
        if entry is None:
            return None
        if now > entry.stale_until:
            _REMOTE_IMAGE_CACHE_BYTES -= len(entry.image.body)
            return None
        _REMOTE_IMAGE_CACHE[key] = entry
        return entry, now <= entry.expires_at


def _store_cached_image(
    raw_url: str,
    image: RemoteMailImage,
    validator_url: str,
) -> None:
    global _REMOTE_IMAGE_CACHE_BYTES
    key = _cache_key(raw_url)
    now = _now()
    entry = _CachedRemoteMailImage(
        image=image,
        validator_url=validator_url,
        expires_at=now + CACHE_TTL_SECONDS,
        stale_until=now + CACHE_STALE_IF_ERROR_SECONDS,
    )
    with _REMOTE_IMAGE_CACHE_LOCK:
        previous = _REMOTE_IMAGE_CACHE.pop(key, None)
        if previous is not None:
            _REMOTE_IMAGE_CACHE_BYTES -= len(previous.image.body)
        _REMOTE_IMAGE_CACHE[key] = entry
        _REMOTE_IMAGE_CACHE_BYTES += len(image.body)
        while (
            len(_REMOTE_IMAGE_CACHE) > MAX_CACHE_ENTRIES
            or _REMOTE_IMAGE_CACHE_BYTES > MAX_CACHE_BYTES
        ):
            _, evicted = _REMOTE_IMAGE_CACHE.popitem(last=False)
            _REMOTE_IMAGE_CACHE_BYTES -= len(evicted.image.body)


def _refresh_cached_image(raw_url: str, entry: _CachedRemoteMailImage) -> None:
    _store_cached_image(raw_url, entry.image, entry.validator_url)


def _safe_validator(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate or len(candidate) > 1024 or "\r" in candidate or "\n" in candidate:
        return ""
    return candidate


class _PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Connect httpcore to one validated IP while its URL retains host/SNI."""

    def __init__(
        self,
        hostname: str,
        address: str,
        delegate: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self._hostname = hostname.casefold().rstrip(".")
        self._address = address
        self._delegate = delegate or httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        if host.casefold().rstrip(".") != self._hostname or port != 443:
            raise httpcore.ConnectError("Remote mail image connection target changed")
        return await self._delegate.connect_tcp(
            self._address,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise httpcore.ConnectError("Unix sockets are not allowed for remote mail images")

    async def sleep(self, seconds: float) -> None:
        await self._delegate.sleep(seconds)


class _PinnedResponseStream(httpx.AsyncByteStream):
    def __init__(self, stream: AsyncIterable[bytes]) -> None:
        self._stream = stream

    async def __aiter__(self) -> AsyncIterator[bytes]:
        async for chunk in self._stream:
            yield chunk

    async def aclose(self) -> None:
        close = getattr(self._stream, "aclose", None)
        if close is not None:
            await close()


class _PinnedTransport(httpx.AsyncBaseTransport):
    """HTTP transport whose TCP destination cannot be changed by later DNS."""

    def __init__(
        self,
        target: ValidatedRemoteImageUrl,
        delegate: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl.create_default_context(),
            max_connections=1,
            max_keepalive_connections=0,
            http1=True,
            http2=False,
            retries=0,
            network_backend=_PinnedNetworkBackend(
                target.hostname,
                target.addresses[0],
                delegate,
            ),
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        core_response = await self._pool.handle_async_request(
            httpcore.Request(
                method=request.method,
                url=httpcore.URL(
                    scheme=request.url.raw_scheme,
                    host=request.url.raw_host,
                    port=request.url.port,
                    target=request.url.raw_path,
                ),
                headers=request.headers.raw,
                content=request.stream,
                extensions=request.extensions,
            )
        )
        stream = cast(AsyncIterable[bytes], core_response.stream)
        return httpx.Response(
            status_code=core_response.status,
            headers=core_response.headers,
            stream=_PinnedResponseStream(stream),
            extensions=core_response.extensions,
        )

    async def aclose(self) -> None:
        await self._pool.aclose()


def _is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


async def _validate_remote_image_url(raw_url: str) -> ValidatedRemoteImageUrl:
    """Validate one HTTPS hop and every address returned by DNS."""
    value = str(raw_url or "").strip()
    if not value or len(value) > MAX_URL_CHARS:
        raise RemoteMailImageError("invalid_url", 400)
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError as error:
        raise RemoteMailImageError("invalid_url", 400) from error
    if parsed.scheme.casefold() != "https" or not parsed.hostname:
        raise RemoteMailImageError("blocked_url", 400)
    if parsed.username or parsed.password or port not in (None, 443):
        raise RemoteMailImageError("blocked_url", 400)
    hostname = parsed.hostname.casefold().rstrip(".")
    if hostname in {"localhost", "localhost.localdomain"}:
        raise RemoteMailImageError("blocked_url", 400)
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None and not _is_public_address(str(literal)):
        raise RemoteMailImageError("blocked_url", 400)
    try:
        addresses = await asyncio.wait_for(
            asyncio.to_thread(
                socket.getaddrinfo,
                hostname,
                443,
                family=socket.AF_UNSPEC,
                type=socket.SOCK_STREAM,
            ),
            timeout=2.0,
        )
    except (OSError, asyncio.TimeoutError) as error:
        raise RemoteMailImageError("unreachable", 502) from error
    if not addresses:
        raise RemoteMailImageError("unreachable", 502)
    try:
        resolved = tuple(dict.fromkeys(str(item[4][0]) for item in addresses))
        if any(not _is_public_address(address) for address in resolved):
            raise RemoteMailImageError("blocked_url", 400)
    except ValueError as error:
        raise RemoteMailImageError("blocked_url", 400) from error
    return ValidatedRemoteImageUrl(
        url=urlunparse(parsed._replace(fragment="")),
        hostname=hostname,
        addresses=resolved,
    )


def _validate_raster_image(body: bytes) -> str:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(body)) as image:
                image_format = str(image.format or "").upper()
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise RemoteMailImageError("invalid_image", 415)
                canonical_type = _MIME_BY_FORMAT.get(image_format)
                if canonical_type is None:
                    raise RemoteMailImageError("invalid_image", 415)
                image.verify()
                return canonical_type
    except RemoteMailImageError:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        UnidentifiedImageError,
        ValueError,
    ) as error:
        raise RemoteMailImageError("invalid_image", 415) from error


async def _read_response(response: httpx.Response) -> RemoteMailImage:
    declared_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if declared_type not in _DECLARED_MIME_TYPES:
        raise RemoteMailImageError("unsupported_media_type", 415)
    declared_size = response.headers.get("content-length", "").strip()
    if declared_size:
        try:
            if int(declared_size) > MAX_IMAGE_BYTES:
                raise RemoteMailImageError("image_too_large", 413)
        except ValueError:
            pass
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_IMAGE_BYTES:
            raise RemoteMailImageError("image_too_large", 413)
        chunks.append(chunk)
    body = b"".join(chunks)
    if not body:
        raise RemoteMailImageError("invalid_image", 415)
    canonical_type = await asyncio.to_thread(_validate_raster_image, body)
    expected_type = _DECLARED_MIME_TYPES[declared_type]
    if expected_type is not None and expected_type != canonical_type:
        raise RemoteMailImageError("invalid_image", 415)
    return RemoteMailImage(
        body=body,
        content_type=canonical_type,
        etag=_safe_validator(response.headers.get("etag")),
        last_modified=_safe_validator(response.headers.get("last-modified")),
    )


async def _fetch_validated_target(
    target: ValidatedRemoteImageUrl,
    transport: httpx.AsyncBaseTransport | None,
    conditional_headers: Mapping[str, str],
) -> RemoteMailImage | _NotModified | str:
    addresses = target.addresses[:MAX_ADDRESS_ATTEMPTS]
    for address_index, address in enumerate(addresses):
        selected_target = replace(target, addresses=(address,))
        request_transport = transport or _PinnedTransport(selected_target)
        timeout = httpx.Timeout(6.0, connect=3.0, read=6.0, write=3.0, pool=3.0)
        try:
            async with httpx.AsyncClient(
                follow_redirects=False,
                timeout=timeout,
                transport=request_transport,
                trust_env=False,
            ) as client:
                headers = {
                    "Accept": ", ".join(sorted(_ACCEPTED_MIME_TYPES)),
                    "User-Agent": _USER_AGENT,
                    **conditional_headers,
                }
                async with client.stream(
                    "GET",
                    selected_target.url,
                    headers=headers,
                ) as response:
                    if response.status_code in _REDIRECT_STATUSES:
                        location = response.headers.get("location", "").strip()
                        if not location:
                            raise RemoteMailImageError("invalid_redirect", 502)
                        redirect_url = urljoin(selected_target.url, location)
                        if not isinstance(redirect_url, str):
                            raise RemoteMailImageError("invalid_redirect", 502)
                        return redirect_url
                    if response.status_code == 304 and conditional_headers:
                        return _NotModified(selected_target.url)
                    if response.status_code != 200:
                        raise RemoteMailImageError("origin_unavailable", 502)
                    return await _read_response(response)
        except (
            httpcore.NetworkError,
            httpcore.ProtocolError,
            httpcore.TimeoutException,
            httpx.NetworkError,
            httpx.RemoteProtocolError,
            httpx.TimeoutException,
        ):
            if transport is not None or address_index + 1 >= len(addresses):
                raise
    raise RemoteMailImageError("unreachable", 502)


def _conditional_revalidation_headers(
    target: ValidatedRemoteImageUrl,
    stale_entry: _CachedRemoteMailImage | None,
) -> dict[str, str]:
    if stale_entry is None or target.url != stale_entry.validator_url:
        return {}
    headers: dict[str, str] = {}
    if stale_entry.image.etag:
        headers["If-None-Match"] = stale_entry.image.etag
    if stale_entry.image.last_modified:
        headers["If-Modified-Since"] = stale_entry.image.last_modified
    return headers


async def fetch_remote_mail_image(
    raw_url: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> RemoteMailImage:
    """Fetch or revalidate one public raster image without persistent storage."""
    cached = _cached_image(raw_url)
    if cached is not None and cached[1]:
        return cached[0].image
    stale_entry = cached[0] if cached is not None else None
    current = raw_url
    try:
        async with asyncio.timeout(TOTAL_TIMEOUT_SECONDS):
            for redirect_count in range(MAX_REDIRECTS + 1):
                target = await _validate_remote_image_url(current)
                result = await _fetch_validated_target(
                    target,
                    transport,
                    _conditional_revalidation_headers(target, stale_entry),
                )
                if isinstance(result, RemoteMailImage):
                    _store_cached_image(raw_url, result, target.url)
                    return result
                if isinstance(result, _NotModified):
                    if stale_entry is None or result.validator_url != stale_entry.validator_url:
                        raise RemoteMailImageError("invalid_revalidation", 502)
                    _refresh_cached_image(raw_url, stale_entry)
                    return stale_entry.image
                if redirect_count >= MAX_REDIRECTS:
                    raise RemoteMailImageError("too_many_redirects", 502)
                current = result
    except RemoteMailImageError as error:
        if stale_entry is not None and error.code in {"timeout", "unreachable"}:
            return stale_entry.image
        raise
    except (asyncio.TimeoutError, httpcore.TimeoutException, httpx.TimeoutException) as error:
        if stale_entry is not None:
            return stale_entry.image
        raise RemoteMailImageError("timeout", 504) from error
    except (
        httpcore.NetworkError,
        httpcore.ProtocolError,
        httpx.NetworkError,
        httpx.RemoteProtocolError,
    ) as error:
        if stale_entry is not None:
            return stale_entry.image
        raise RemoteMailImageError("unreachable", 502) from error
    raise RemoteMailImageError("origin_unavailable", 502)
