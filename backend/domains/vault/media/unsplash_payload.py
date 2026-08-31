"""Read the provider JSON shape without coercing returned field values."""

from collections.abc import Iterable

from backend.domains.vault.media.contracts import UnsplashPhoto, UnsplashSearch


def _member(value: object, key: str) -> object:
    if not isinstance(value, dict):
        raise TypeError("Expected an Unsplash JSON object")
    result: object = value[key]
    return result


def search_payload(value: object) -> UnsplashSearch:
    """Preserve defaults, leaf identity and historical empty iterable results.

    Shape errors still flow to the route's existing 502 handler; this does not
    validate or normalize the leaf values accepted by direct callers.
    """
    if not isinstance(value, dict):
        raise TypeError("Expected an Unsplash search object")
    images: object = value.get("results", [])
    if not isinstance(images, Iterable):
        raise TypeError("Expected iterable Unsplash results")
    results: list[UnsplashPhoto] = []
    for image in images:
        urls = _member(image, "urls")
        user = _member(image, "user")
        results.append(
            {
                "id": _member(image, "id"),
                "url": _member(urls, "regular"),
                "thumb": _member(urls, "small"),
                "author": _member(user, "name"),
                "author_url": _member(_member(user, "links"), "html"),
            }
        )
    return {"results": results, "total_pages": value.get("total_pages", 1)}
