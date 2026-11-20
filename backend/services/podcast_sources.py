"""Readable source selection for daily podcasts."""

from collections.abc import Callable, Sequence
from contextlib import closing
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any

from backend.services.agent_execution_models import AgentExecutionSnapshot

def readable_podcast_articles(articles: Sequence[Any]) -> tuple[list[Any], list[dict[str, str]]]:
    """Normalize readable bodies and report omissions without inventing content."""
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

def freeze_podcast_input(
    snapshot: AgentExecutionSnapshot, period_end: datetime, resolve_language: Callable[[], tuple[str, str]],
) -> dict[str, Any] | None:
    """Load the parent’s immutable episode input, or capture the original 24-hour window."""
    from backend.data.db import get_db
    from backend.models.reader import Article
    from backend.services.agent_execution_store import work_checkpoint

    if snapshot.parent_run_id:
        saved = work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-input")
        if saved is not None:
            return saved
    period_start = period_end - timedelta(hours=24)
    with closing(get_db()) as sessions:
        db = next(sessions)
        articles = db.query(Article).filter(Article.published_at > period_start, Article.published_at <= period_end).all()
        if not articles:
            return None
        rows = [{"id": str(article.id), "title": str(article.title or ""),
                 "full_content": str(article.full_content or ""), "content": str(article.content or ""),
                 "source": str(article.source.name if article.source else "")} for article in articles]
    code, language = resolve_language()
    result = {"articles": rows, "period_start": period_start.isoformat(), "period_end": period_end.isoformat(),
              "language_code": code, "language_name": language,
              "audio_filename": f"daily_podcast_{period_end.astimezone().strftime('%Y_%m_%d')}.mp3"}
    if snapshot.parent_run_id:
        work_checkpoint(snapshot.scope, snapshot.parent_run_id, "podcast-input", result)
    return result


def restore_articles(podcast_input: dict[str, Any]) -> list[Any]:
    """Use the same detached article shape on initial generation and restart."""
    return [SimpleNamespace(**{**row, "source": SimpleNamespace(name=row["source"])})
            for row in podcast_input["articles"]]
