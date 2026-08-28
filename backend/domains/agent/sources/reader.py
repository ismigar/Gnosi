"""Reader inventory, search and exact-read adapters."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_

from backend.domains.agent.sources.scopes import (
    MAX_EXCERPT_CHARS,
    MAX_RECORD_CHARS,
    _apply_reader_scope,
    _plain_text,
)


def _reader_session() -> Any:
    """Resolve the legacy seam lazily so monkeypatches remain observable."""
    from backend.agent import internal_sources

    return internal_sources._reader_session()


def _article_payload(
    article: Any,
    *,
    full: bool = False,
    content_offset: int = 0,
    content_limit: int = MAX_RECORD_CHARS,
) -> dict[str, Any]:
    source = getattr(article, "source", None)
    body = article.full_content if full and article.full_content else article.content
    content = _plain_text(body, None)
    offset = max(0, int(content_offset or 0)) if full else 0
    limit = max(1, min(int(content_limit or MAX_RECORD_CHARS), 32_000))
    chunk = content[offset : offset + limit]
    payload = {
        "id": str(article.id),
        "title": str(article.title or ""),
        "source_id": article.source_id,
        "source": str(getattr(source, "name", "") or ""),
        "category": str(getattr(source, "category", "") or ""),
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "is_read": bool(article.is_read),
        "url": str(article.url or ""),
        "content": chunk if full else content[:MAX_EXCERPT_CHARS],
    }
    if full:
        payload.update(
            {
                "content_char_count": len(content),
                "content_offset": offset,
                "content_limit": limit,
                "content_has_more": offset + len(chunk) < len(content),
                "next_content_offset": (
                    offset + len(chunk) if offset + len(chunk) < len(content) else None
                ),
            }
        )
    return payload


def _reader_inventory(scope: dict[str, Any]) -> dict[str, Any]:
    from backend.models.reader import Article, FeedSource

    db = _reader_session()
    try:
        base = _apply_reader_scope(db.query(Article), scope)
        count = int(base.with_entities(func.count(Article.id)).scalar() or 0)
        read_count = int(
            base.filter(Article.is_read.is_(True)).with_entities(func.count(Article.id)).scalar()
            or 0
        )
        unread_count = int(
            base.filter(Article.is_read.is_(False)).with_entities(func.count(Article.id)).scalar()
            or 0
        )
        feed_count = int(
            base.with_entities(func.count(func.distinct(Article.source_id))).scalar() or 0
        )
        oldest, newest = base.with_entities(
            func.min(Article.published_at), func.max(Article.published_at)
        ).one()
        breakdown_query = _apply_reader_scope(
            db.query(
                FeedSource.id,
                FeedSource.name,
                FeedSource.category,
                func.count(Article.id),
            ).join(Article, Article.source_id == FeedSource.id),
            scope,
            feed_source_joined=True,
        )
        sources = [
            {"id": row[0], "name": row[1], "category": row[2], "count": int(row[3])}
            for row in breakdown_query.group_by(FeedSource.id, FeedSource.name, FeedSource.category)
            .order_by(func.count(Article.id).desc())
            .limit(100)
        ]
        category_label = func.coalesce(
            func.nullif(FeedSource.category, ""),
            "Uncategorized",
        )
        category_query = _apply_reader_scope(
            db.query(
                category_label,
                func.count(Article.id),
            ).join(Article, Article.source_id == FeedSource.id),
            scope,
            feed_source_joined=True,
        )
        categories = [
            {
                "category": str(row[0] or "Uncategorized"),
                "count": int(row[1]),
            }
            for row in category_query.group_by(category_label)
            .order_by(func.count(Article.id).desc())
            .limit(100)
        ]
        category_count_query = _apply_reader_scope(
            db.query(func.count(func.distinct(category_label))).join(
                Article,
                Article.source_id == FeedSource.id,
            ),
            scope,
            feed_source_joined=True,
        )
        category_count = int(category_count_query.scalar() or 0)
        return {
            "source": "reader",
            "count": count,
            "read_count": read_count,
            "unread_count": unread_count,
            "feed_count": feed_count,
            "category_count": category_count,
            "oldest": oldest.isoformat() if oldest else None,
            "newest": newest.isoformat() if newest else None,
            "feeds": sources,
            "categories": categories,
            "record_fields": [
                "id",
                "title",
                "content",
                "is_read",
                "source_id",
                "source",
                "category",
                "published_at",
                "url",
            ],
            "scope": scope,
        }
    finally:
        db.close()


def _reader_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    from sqlalchemy.orm import joinedload

    from backend.models.reader import Article

    db = _reader_session()
    try:
        query = db.query(Article).options(joinedload(Article.source))
        query = _apply_reader_scope(query, scope)
        term = str(query_text or "").strip()
        if term:
            pattern = f"%{term}%"
            query = query.filter(
                or_(
                    Article.title.ilike(pattern),
                    Article.content.ilike(pattern),
                    Article.full_content.ilike(pattern),
                )
            )
        matching_count = int(query.with_entities(func.count(Article.id)).scalar() or 0)
        rows = (
            query.order_by(Article.published_at.desc(), Article.id.desc())
            .offset(scope["offset"])
            .limit(scope["limit"])
            .all()
        )
        return {
            "source": "reader",
            "query": term,
            "matching_count": matching_count,
            "offset": scope["offset"],
            "limit": scope["limit"],
            "has_more": scope["offset"] + len(rows) < matching_count,
            "records": [_article_payload(row, full=scope["include_full_content"]) for row in rows],
        }
    finally:
        db.close()


def _reader_read(
    scope: dict[str, Any],
    record_id: str,
    *,
    content_offset: int = 0,
    content_limit: int = MAX_RECORD_CHARS,
) -> dict[str, Any]:
    from sqlalchemy.orm import joinedload

    from backend.models.reader import Article

    try:
        article_id = int(record_id)
    except (TypeError, ValueError) as error:
        raise ValueError("Invalid Reader article id.") from error
    db = _reader_session()
    try:
        query = (
            db.query(Article).options(joinedload(Article.source)).filter(Article.id == article_id)
        )
        article = _apply_reader_scope(query, scope).first()
        if not article:
            raise KeyError(record_id)
        return _article_payload(
            article,
            full=True,
            content_offset=content_offset,
            content_limit=content_limit,
        )
    finally:
        db.close()
