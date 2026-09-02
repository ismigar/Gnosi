"""Ephemeral, SSRF-hardened recovery for remote mail raster images."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
import warnings
from dataclasses import dataclass
from io import BytesIO
from typing import AsyncIterable, AsyncIterator, Iterable, cast
from urllib.parse import urljoin, urlparse, urlunparse

import httpcore
import httpx
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
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
_USER_AGENT = "Gnosi-Mail-Image-Recovery/1.0"


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


@dataclass(frozen=True)
class ValidatedRemoteImageUrl:
    url: str
    hostname: str
    addresses: tuple[str, ...]


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


def _validate_raster_image(body: bytes, declared_type: str) -> None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(body)) as image:
                image_format = str(image.format or "").upper()
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise RemoteMailImageError("invalid_image", 415)
                if _MIME_BY_FORMAT.get(image_format) != declared_type:
                    raise RemoteMailImageError("invalid_image", 415)
                image.verify()
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
    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in _ACCEPTED_MIME_TYPES:
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
    await asyncio.to_thread(_validate_raster_image, body, content_type)
    return RemoteMailImage(body=body, content_type=content_type)


async def fetch_remote_mail_image(
    raw_url: str,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> RemoteMailImage:
    """Fetch one public raster image without forwarding state or persisting it."""
    current = raw_url
    try:
        async with asyncio.timeout(TOTAL_TIMEOUT_SECONDS):
            for redirect_count in range(MAX_REDIRECTS + 1):
                target = await _validate_remote_image_url(current)
                timeout = httpx.Timeout(6.0, connect=3.0, read=6.0, write=3.0, pool=3.0)
                request_transport = transport or _PinnedTransport(target)
                async with httpx.AsyncClient(
                    follow_redirects=False,
                    timeout=timeout,
                    transport=request_transport,
                    trust_env=False,
                ) as client:
                    async with client.stream(
                        "GET",
                        target.url,
                        headers={
                            "Accept": ", ".join(sorted(_ACCEPTED_MIME_TYPES)),
                            "User-Agent": _USER_AGENT,
                        },
                    ) as response:
                        if response.status_code in _REDIRECT_STATUSES:
                            if redirect_count >= MAX_REDIRECTS:
                                raise RemoteMailImageError("too_many_redirects", 502)
                            location = response.headers.get("location", "").strip()
                            if not location:
                                raise RemoteMailImageError("invalid_redirect", 502)
                            current = urljoin(target.url, location)
                            continue
                        if response.status_code != 200:
                            raise RemoteMailImageError("origin_unavailable", 502)
                        return await _read_response(response)
    except RemoteMailImageError:
        raise
    except (asyncio.TimeoutError, httpcore.TimeoutException, httpx.TimeoutException) as error:
        raise RemoteMailImageError("timeout", 504) from error
    except (
        httpcore.NetworkError,
        httpcore.ProtocolError,
        httpx.NetworkError,
        httpx.RemoteProtocolError,
    ) as error:
        raise RemoteMailImageError("unreachable", 502) from error
    raise RemoteMailImageError("origin_unavailable", 502)
