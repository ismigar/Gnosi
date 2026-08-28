"""Governed tools for inspecting and analysing Gnosi Reader content."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, List

try:
    import langchain_core.tools as _langchain_tools
except Exception:  # pragma: no cover - keeps helpers importable in lean tests
    _langchain_tools = None  # type: ignore[assignment]

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from backend.models.reader import Article


def tool(fn: Callable[..., Any]) -> Any:
    """Use LangChain's decorator, with an identity fallback for lean imports."""
    if _langchain_tools is None:
        return fn
    return _langchain_tools.tool(fn)


def _vault_path() -> Path:
    from backend.services.context_vars import get_active_vault_path

    vault_path = get_active_vault_path()
    if vault_path is None:
        raise RuntimeError("No active Vault is available for Reader tools")
    return vault_path


def _scope(
    unread_only: bool,
    source_ids: List[int],
    categories: List[str],
    date_from: str,
    date_to: str,
) -> dict[str, object]:
    return {
        "unread_only": unread_only,
        "source_ids": source_ids,
        "categories": categories,
        "date_from": date_from,
        "date_to": date_to,
    }


@tool
def reader_inventory(
    unread_only: bool = True,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
) -> str:
    """Return an exact count and feed breakdown for a scoped Reader corpus."""
    from backend.agent.internal_sources import _reader_inventory, normalize_internal_scope

    scope = normalize_internal_scope(
        "reader",
        _scope(unread_only, source_ids or [], categories or [], date_from, date_to),
    )
    return json.dumps(_reader_inventory(scope), ensure_ascii=False, default=str)


@tool
def search_reader_articles(
    query: str,
    unread_only: bool = True,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
    limit: int = 12,
) -> str:
    """Search Reader articles with bounded excerpts and exact article IDs."""
    from backend.agent.internal_sources import _reader_search, normalize_internal_scope

    raw_scope = _scope(
        unread_only,
        source_ids or [],
        categories or [],
        date_from,
        date_to,
    )
    raw_scope["limit"] = limit
    scope = normalize_internal_scope("reader", raw_scope)
    return json.dumps(_reader_search(scope, query), ensure_ascii=False, default=str)


@tool
def read_reader_article(
    article_id: str,
    unread_only: bool = False,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
) -> str:
    """Read one exact Reader article while re-applying the requested scope."""
    from backend.agent.internal_sources import _reader_read, normalize_internal_scope

    scope = normalize_internal_scope(
        "reader",
        _scope(unread_only, source_ids or [], categories or [], date_from, date_to),
    )
    return json.dumps(_reader_read(scope, article_id), ensure_ascii=False, default=str)


@tool
def start_reader_topic_analysis(
    unread_only: bool = True,
    source_ids: List[int] | None = None,
    categories: List[str] | None = None,
    date_from: str = "",
    date_to: str = "",
    language: str = "Catalan",
    guidance: str = "",
) -> str:
    """Start a durable, model-costing topic-evolution analysis after an explicit request."""
    from backend.services.reader_analysis import start_analysis

    result = start_analysis(
        _vault_path(),
        _scope(unread_only, source_ids or [], categories or [], date_from, date_to),
        language=language,
        guidance=guidance,
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
def reader_analysis_status(job_id: str) -> str:
    """Read progress for a durable Reader topic-analysis job."""
    from backend.services.reader_analysis import get_status

    return json.dumps(get_status(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def read_reader_analysis(job_id: str) -> str:
    """Read the cited result of a completed Reader topic-analysis job."""
    from backend.services.reader_analysis import read_result

    return json.dumps(read_result(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def resume_reader_topic_analysis(job_id: str) -> str:
    """Resume a failed or interrupted model-costing Reader analysis."""
    from backend.services.reader_analysis import resume_analysis

    return json.dumps(resume_analysis(_vault_path(), job_id), ensure_ascii=False, default=str)


@tool
def cancel_reader_topic_analysis(job_id: str) -> str:
    """Request cooperative cancellation of a running Reader analysis."""
    from backend.services.reader_analysis import cancel_analysis

    return json.dumps(cancel_analysis(_vault_path(), job_id), ensure_ascii=False, default=str)


def _reader_article(article_id: int) -> tuple[Session, Article | None]:
    from backend.data.db import get_engine_for_path
    from backend.models.reader import Article

    _engine, session_factory = get_engine_for_path(Path(_vault_path()))
    session = session_factory()
    article = session.query(Article).filter(Article.id == int(article_id)).first()
    return session, article


@tool
def mark_reader_article_read(article_id: int, read: bool = True) -> str:
    """Mark one exact Reader article read or unread after an explicit request."""
    session, article = _reader_article(article_id)
    try:
        if article is None:
            return json.dumps({"error": "Article not found."})
        setattr(article, "is_read", bool(read))
        session.commit()
        return json.dumps({
            "status": "updated", "article_id": article.id, "is_read": article.is_read,
        })
    finally:
        session.close()


@tool
def extract_reader_article(article_id: int) -> str:
    """Fetch and persist full text for one exact Reader article."""
    from backend.services.article_extractor import extract_full_content

    session, article = _reader_article(article_id)
    try:
        if article is None:
            return json.dumps({"error": "Article not found."})
        extracted = extract_full_content(str(article.url or ""))
        if not extracted:
            return json.dumps({"status": "unavailable", "article_id": article.id})
        setattr(article, "full_content", extracted)
        session.commit()
        return json.dumps({
            "status": "updated", "article_id": article.id, "length": len(extracted),
        })
    finally:
        session.close()


@tool
def save_reader_article_to_vault(
    article_id: int,
    folder: str = "Inbox/Reader",
) -> str:
    """Save one exact Reader article as an idempotent Vault page."""
    from backend.agent.gnosi_tools import _page_files, _parse, _write_page
    from backend.utils.safe_io import sanitize_rel_folder, sanitize_vault_title

    session, article = _reader_article(article_id)
    try:
        if article is None:
            return json.dumps({"error": "Article not found."})
        for path in _page_files():
            try:
                metadata, _body = _parse(path)
            except Exception:
                continue
            if str(metadata.get("reader_article_id") or "") == str(article.id):
                return json.dumps({
                    "status": "exists", "article_id": article.id,
                    "page_id": str(metadata.get("id") or ""),
                })
        target_folder = Path(_vault_path()) / sanitize_rel_folder(folder)
        target_folder.mkdir(parents=True, exist_ok=True)
        title = sanitize_vault_title(str(article.title or f"Reader article {article.id}"))
        target = target_folder / f"{title}.md"
        suffix = 2
        while target.exists():
            target = target_folder / f"{title} ({suffix}).md"
            suffix += 1
        page_id = str(uuid.uuid4())
        source_name = article.source.name if article.source else ""
        metadata = {
            "id": page_id,
            "title": article.title or title,
            "reader_article_id": article.id,
            "source": source_name,
            "source_url": article.url,
            "published_at": str(article.published_at or ""),
            "tags": ["reader"],
        }
        content = str(article.full_content or article.content or "")
        _write_page(target, metadata, content)
        return json.dumps({
            "status": "created", "article_id": article.id, "page_id": page_id,
        })
    finally:
        session.close()


@tool
def reader_podcast_status() -> str:
    """Read status and metadata for the current Reader podcast generation."""
    from backend.api.reader import get_podcast_info, get_podcast_status

    return json.dumps({
        "generation": get_podcast_status(), "latest": get_podcast_info(),
    }, ensure_ascii=False, default=str)


@tool
def generate_reader_podcast() -> str:
    """Start the cost-bearing Reader podcast job after an explicit request."""
    from backend.api.reader import trigger_podcast_generation

    return json.dumps(trigger_podcast_generation(), ensure_ascii=False, default=str)


READER_READ_TOOLS = [
    reader_inventory,
    search_reader_articles,
    read_reader_article,
    reader_analysis_status,
    read_reader_analysis,
    reader_podcast_status,
]
READER_AI_TOOLS = [
    start_reader_topic_analysis,
    resume_reader_topic_analysis,
    generate_reader_podcast,
]
READER_WRITE_TOOLS = [
    cancel_reader_topic_analysis,
    mark_reader_article_read,
    extract_reader_article,
    save_reader_article_to_vault,
]
