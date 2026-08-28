"""Snapshot, map/reduce and report rendering for Reader analyses."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import joinedload

from backend.domains.reader.internal_sources import apply_reader_scope, plain_text
from backend.domains.reader.state import MAX_BATCH_CHARS, MAX_REDUCE_CHARS
from backend.services.vault_routing import canonical_vault_browser_path


def _article_text(article: Any) -> str:
    return plain_text(
        article.full_content or article.content or "",
        None,
    )


def _snapshot_articles(vault_path: Path, scope: Dict[str, Any]) -> List[Dict[str, Any]]:
    from backend.data.db import get_engine_for_path
    from backend.models.reader import Article

    _engine, session_factory = get_engine_for_path(vault_path)
    db = session_factory()
    try:
        query = db.query(Article).options(joinedload(Article.source))
        query = apply_reader_scope(query, scope)
        rows = query.order_by(Article.published_at.asc(), Article.id.asc()).all()
        return [
            {
                "id": str(article.id),
                "title": str(article.title or "")[:1_000],
                "source_id": article.source_id,
                "source": str(getattr(article.source, "name", "") or ""),
                "category": str(getattr(article.source, "category", "") or "Uncategorized"),
                "published_at": article.published_at.isoformat() if article.published_at else None,
                "url": str(article.url or "")[:2_000],
                "is_read": bool(article.is_read),
                "content": _article_text(article),
            }
            for article in rows
        ]
    finally:
        db.close()


def _digest_snapshot(rows: List[Dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        digest.update(json.dumps(row, ensure_ascii=True, sort_keys=True).encode("utf-8"))
    return digest.hexdigest()


def _topic_for(row: Dict[str, Any]) -> str:
    category = str(row.get("category") or "").strip()
    if category and category.casefold() not in {"uncategorized", "sense categoria"}:
        return category
    return str(row.get("source") or "Uncategorized").strip() or "Uncategorized"


def _build_batches(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        metadata = {**row, "content": ""}
        metadata_chars = len(json.dumps(metadata, ensure_ascii=False))
        content_chars = max(4_000, MAX_BATCH_CHARS - metadata_chars - 1_000)
        content = str(row.get("content") or "")
        if len(content) <= content_chars:
            grouped[_topic_for(row)].append(row)
            continue
        part_count = (len(content) + content_chars - 1) // content_chars
        for part_index, offset in enumerate(range(0, len(content), content_chars)):
            grouped[_topic_for(row)].append(
                {
                    **row,
                    "content": content[offset : offset + content_chars],
                    "content_offset": offset,
                    "content_char_count": len(content),
                    "content_part": part_index + 1,
                    "content_parts": part_count,
                }
            )

    batches: List[Dict[str, Any]] = []
    for topic in sorted(grouped, key=str.casefold):
        current: List[Dict[str, Any]] = []
        current_chars = 0
        for row in grouped[topic]:
            encoded_chars = len(json.dumps(row, ensure_ascii=False))
            if current and current_chars + encoded_chars > MAX_BATCH_CHARS:
                batches.append({"topic": topic, "articles": current})
                current = []
                current_chars = 0
            current.append(row)
            current_chars += encoded_chars
        if current:
            batches.append({"topic": topic, "articles": current})
    return batches


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    body = str(text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", body, re.DOTALL)
    candidate = fenced.group(1) if fenced else body
    if not candidate.startswith("{"):
        match = re.search(r"\{.*\}", candidate, re.DOTALL)
        candidate = match.group(0) if match else ""
    try:
        parsed = json.loads(candidate)
    except (TypeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _default_model_call(prompt: str, user_message: str) -> str:
    from backend.agent.factory import generate_text

    text, _model = generate_text(prompt, user_message=user_message, timeout=120)
    return text


def _fallback_batch_summary(batch: Dict[str, Any]) -> Dict[str, Any]:
    articles = batch["articles"]
    article_ids = list(dict.fromkeys(item["id"] for item in articles))
    first = articles[0]
    last = articles[-1]
    titles = [str(item.get("title") or "") for item in articles[:12]]
    return {
        "topic": batch["topic"],
        "period_start": first.get("published_at"),
        "period_end": last.get("published_at"),
        "article_count": len(article_ids),
        "summary": "; ".join(title for title in titles if title)[:4_000],
        "developments": [],
        "article_ids": article_ids[:20],
        "_article_ids_all": article_ids,
        "fallback": True,
    }


def _map_batch(
    batch: Dict[str, Any],
    *,
    language: str,
    guidance: str,
    model_call: Callable[[str, str], str],
) -> Dict[str, Any]:
    articles = batch["articles"]
    prompt = (
        "You are analysing one chronological batch from a Reader collection "
        "to answer the user's request. "
        f"Canonical topic: {batch['topic']}. Output language: {language}. "
        "Every supplied article belongs to this batch. Return only JSON with keys "
        "topic, period_start, period_end, article_count, summary, developments, "
        "and article_ids. developments must be a chronological list of concise "
        "changes, each with date, claim, and supporting article_ids. Do not invent "
        "facts or identifiers. Keep representative article_ids from the input."
        " An article may span multiple content parts; integrate every supplied "
        "part with the same id before drawing conclusions."
    )
    if guidance:
        prompt += f"\nUSER READER REQUEST:\n{guidance}"
    prompt += "\nARTICLES:\n" + "\n".join(json.dumps(item, ensure_ascii=False) for item in articles)
    parsed = _extract_json(model_call(prompt, "Analyse this Reader batch for the request"))
    if not parsed:
        return _fallback_batch_summary(batch)
    all_article_ids = list(dict.fromkeys(item["id"] for item in articles))
    allowed_ids = set(all_article_ids)
    ids = [str(value) for value in parsed.get("article_ids") or [] if str(value) in allowed_ids][
        :50
    ]
    developments = []
    for item in parsed.get("developments") or []:
        if not isinstance(item, dict):
            continue
        developments.append(
            {
                "date": str(item.get("date") or "")[:100],
                "claim": str(item.get("claim") or "")[:2_000],
                "article_ids": [
                    str(value)
                    for value in item.get("article_ids") or []
                    if str(value) in allowed_ids
                ][:20],
            }
        )
    return {
        "topic": batch["topic"],
        "period_start": articles[0].get("published_at"),
        "period_end": articles[-1].get("published_at"),
        "article_count": len(all_article_ids),
        "summary": str(parsed.get("summary") or "")[:6_000],
        "developments": developments[:30],
        "article_ids": ids or all_article_ids[:20],
        "_article_ids_all": all_article_ids,
        "fallback": False,
    }


def _reduce_once(
    topic: str,
    summaries: List[Dict[str, Any]],
    *,
    language: str,
    guidance: str,
    model_call: Callable[[str, str], str],
) -> Dict[str, Any]:
    allowed_ids = {
        str(identifier)
        for summary in summaries
        for identifier in (summary.get("_article_ids_all") or summary.get("article_ids") or [])
    }
    model_summaries = [
        {key: value for key, value in summary.items() if key != "_article_ids_all"}
        for summary in summaries
    ]
    prompt = (
        f"Combine chronological batch analyses for the canonical news topic "
        f"{topic!r}. Output language: {language}. Return only JSON with keys "
        "topic, evolution, turning_points, and article_ids. Preserve chronology, "
        "answer the user's Reader request, distinguish sustained trends from "
        "one-off events when relevant, and cite only supplied article ids. Do "
        "not invent evidence.\nUSER READER REQUEST:\n"
        + (guidance or "Provide a faithful synthesis of the selected collection.")
        + "\nBATCH ANALYSES:\n"
        + json.dumps(model_summaries, ensure_ascii=False)
    )
    parsed = _extract_json(model_call(prompt, "Synthesize this Reader topic for the request"))
    if not parsed:
        return {
            "topic": topic,
            "evolution": "\n\n".join(str(item.get("summary") or "") for item in summaries)[:12_000],
            "turning_points": [
                development for item in summaries for development in item.get("developments") or []
            ][:100],
            "article_ids": list(allowed_ids)[:100],
            "_article_ids_all": sorted(allowed_ids),
            "fallback": True,
        }
    ids = [str(value) for value in parsed.get("article_ids") or [] if str(value) in allowed_ids][
        :100
    ]
    return {
        "topic": topic,
        "evolution": str(parsed.get("evolution") or "")[:12_000],
        "turning_points": list(parsed.get("turning_points") or [])[:100],
        "article_ids": ids or list(allowed_ids)[:100],
        "_article_ids_all": sorted(allowed_ids),
        "fallback": False,
    }


def _reduce_topic(
    topic: str,
    summaries: List[Dict[str, Any]],
    *,
    language: str,
    guidance: str,
    model_call: Callable[[str, str], str],
) -> Dict[str, Any]:
    current: List[Dict[str, Any]] = summaries
    while len(json.dumps(current, ensure_ascii=False)) > MAX_REDUCE_CHARS:
        reduced: List[Dict[str, Any]] = []
        chunk: List[Dict[str, Any]] = []
        chunk_chars = 0
        for summary in current:
            size = len(json.dumps(summary, ensure_ascii=False))
            if chunk and chunk_chars + size > MAX_REDUCE_CHARS:
                reduced.append(
                    _reduce_once(
                        topic,
                        chunk,
                        language=language,
                        guidance=guidance,
                        model_call=model_call,
                    )
                )
                chunk = []
                chunk_chars = 0
            chunk.append(summary)
            chunk_chars += size
        if chunk:
            reduced.append(
                _reduce_once(
                    topic,
                    chunk,
                    language=language,
                    guidance=guidance,
                    model_call=model_call,
                )
            )
        current = reduced
    result = _reduce_once(
        topic,
        current,
        language=language,
        guidance=guidance,
        model_call=model_call,
    )
    result["article_count"] = len(
        {
            str(identifier)
            for summary in summaries
            for identifier in (summary.get("_article_ids_all") or summary.get("article_ids") or [])
        }
    )
    result["period_start"] = summaries[0].get("period_start")
    result["period_end"] = summaries[-1].get("period_end")
    result.pop("_article_ids_all", None)
    return result


def _render_report(result: Dict[str, Any]) -> str:
    lines = [
        "# Reader analysis",
        "",
        f"Request: {result.get('request') or 'General collection synthesis'}",
        "",
        f"Articles analysed: {result['article_count']}",
        f"Snapshot: `{result['snapshot_digest']}`",
        "",
    ]
    for topic in result["topics"]:
        lines.extend(
            [
                f"## {topic['topic']}",
                "",
                str(topic.get("evolution") or "No summary was produced."),
                "",
                (
                    f"Period: {topic.get('period_start') or 'unknown'} — "
                    f"{topic.get('period_end') or 'unknown'} · "
                    f"Articles: {topic.get('article_count') or 0}"
                ),
                "",
            ]
        )
        ids = list(topic.get("article_ids") or [])[:20]
        if ids:
            lines.append(
                "Evidence: "
                + ", ".join(
                    f"[Reader #{identifier}]"
                    f"({canonical_vault_browser_path('reader', f'article/{identifier}')})"
                    for identifier in ids
                )
            )
            lines.append("")
    return "\n".join(lines).strip() + "\n"
