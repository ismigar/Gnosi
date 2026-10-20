"""Optional page covers from bibliographic providers and publisher metadata."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

log = logging.getLogger(__name__)


def image_url(value: object, base_url: str = "") -> str | None:
    """Accept web images only; resolve relative publisher image references."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        url = urljoin(base_url, value.strip())
        parsed = urlsplit(url)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname:
            return None
        if parsed.username or parsed.password:
            return None
        return url
    except ValueError:
        return None


def openlibrary_cover(book: Mapping[str, object]) -> str | None:
    """Use a cover actually supplied for this edition, largest size first."""
    covers = book.get("cover")
    if isinstance(covers, Mapping):
        for size in ("large", "medium", "small"):
            cover = image_url(covers.get(size))
            if cover:
                return cover
    return None


class _ImageMetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.values: dict[str, str] = {}
        self.base_url = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "base" and not self.base_url:
            self.base_url = attributes.get("href") or ""
        if tag == "meta":
            key = (attributes.get("property") or attributes.get("name") or "").lower()
            value = attributes.get("content")
            if value:
                self.values.setdefault(key, value)


def html_cover(html: str, page_url: str) -> str | None:
    """Extract the publisher's declared image without guessing asset URLs."""
    parser = _ImageMetadataParser()
    try:
        parser.feed(html)
    except (ValueError, AssertionError):
        return None
    # A DOI resolver may return HTML from another host. Publishers commonly
    # declare the canonical article URL even when their image URL is relative.
    base = image_url(parser.base_url, page_url)
    base = base or image_url(parser.values.get("og:url"), page_url) or page_url
    for key in (
        "citation_image",
        "og:image:secure_url",
        "og:image",
        "twitter:image",
        "twitter:image:src",
    ):
        cover = image_url(parser.values.get(key), base)
        if cover:
            return cover
    return None


def add_page_cover(
    metadata: dict[str, object],
    page_url: object,
    http_get_public: Callable[[str], str | None],
) -> dict[str, object]:
    """Best effort: cover failures must never discard usable reference data."""
    url = image_url(page_url)
    if metadata.get("cover") or not url:
        return metadata
    try:
        body = http_get_public(url)
        cover = html_cover(body, url) if body else None
        if cover:
            metadata["cover"] = cover
    except Exception:
        log.debug("Could not discover a reference cover", exc_info=True)
    return metadata
