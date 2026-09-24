"""Reference covers remain optional and never replace an existing choice."""

import pytest

from backend.domains.vault.citations.cover_metadata import (
    add_page_cover,
    html_cover,
    image_url,
    openlibrary_cover,
)


def test_book_uses_largest_available_edition_cover():
    assert openlibrary_cover({"cover": {
        "small": "https://covers.openlibrary.org/b/id/42-S.jpg",
        "large": "https://covers.openlibrary.org/b/id/42-L.jpg",
    }}) == "https://covers.openlibrary.org/b/id/42-L.jpg"
    assert openlibrary_cover({"cover": {"medium": "https://example.org/book.jpg"}})
    assert openlibrary_cover({"title": "No cover"}) is None


def test_html_uses_publisher_image_and_decodes_entities():
    html = '''<meta content='/cover.jpg?size=large&amp;page=1' property='og:image'>
              <meta name='twitter:image' content='https://example.org/social.jpg'>'''
    assert html_cover(html, "https://publisher.example/article/1") == (
        "https://publisher.example/cover.jpg?size=large&page=1"
    )


def test_relative_image_uses_canonical_page_after_doi_redirect():
    html = '''<meta property='og:url' content='https://publisher.example/paper/1'>
              <meta property='og:image' content='image.png'>'''
    assert html_cover(html, "https://doi.org/10.1234/paper") == (
        "https://publisher.example/paper/image.png"
    )


@pytest.mark.parametrize("value", [None, {}, "", "javascript:alert(1)",
                                  "data:image/png;base64,AAAA", "file:///cover.png",
                                  "https://user:password@example.org/image.png"])
def test_non_web_images_are_ignored(value):
    assert image_url(value) is None


def test_unavailable_publisher_does_not_break_reference():
    metadata = {"Title": "Reference", "DOI": "10.1234/example"}

    def unavailable(url):
        raise TimeoutError("offline")

    assert add_page_cover(metadata, "https://example.org/paper", unavailable) is metadata
    assert "cover" not in metadata


def test_existing_cover_is_preserved_without_network():
    metadata = {"Title": "Reference", "cover": "Assets/Covers/manual.jpg"}

    def forbidden(url):
        pytest.fail("An existing cover must not trigger a lookup")

    assert add_page_cover(metadata, "https://example.org/paper", forbidden) is metadata
    assert metadata["cover"] == "Assets/Covers/manual.jpg"
