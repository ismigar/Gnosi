"""Readable source selection for daily podcasts."""

from collections.abc import Sequence
from typing import Any

def readable_podcast_articles(articles: Sequence[Any]) -> tuple[list[Any], list[dict[str, str]]]:
    """Normalize readable bodies and report omissions without inventing content."""
    from types import SimpleNamespace
    from backend.domains.reader.internal_sources import plain_text

    readable: list[Any] = []
    skipped: list[dict[str, str]] = []
    for article in articles:
        text = plain_text(article.full_content or "", None).strip()
        if not text:
            text = plain_text(article.content or "", None).strip()
        if not text:
            skipped.append({"id": str(article.id), "title": str(article.title or "")})
            continue
        readable.append(SimpleNamespace(id=article.id, title=article.title,
                                        full_content=text, content=text, source=article.source))
    return readable, skipped
