"""Validate and cache display translations without changing proposal evidence."""
from __future__ import annotations
import json
import re
from collections.abc import Callable

LANGUAGES = {"ca": "Catalan", "en": "English", "es": "Spanish", "fr": "French"}


def locale_code(value: str) -> str:
    base = value.replace("_", "-").split("-", 1)[0].lower()
    return base if base in LANGUAGES else "en"


def translated_text(item: dict[str, object], locale: str) -> dict[str, str] | None:
    if locale_code(str(item.get("source_locale") or "en")) == locale:
        return {"title": str(item.get("title") or ""), "why": str(item.get("why") or "")}
    cache = item.get("localizations")
    text = cache.get(locale) if isinstance(cache, dict) else None
    if isinstance(text, dict) and isinstance(text.get("title"), str) and isinstance(text.get("why"), str):
        return {"title": text["title"], "why": text["why"]}
    return None


def translate_batch(items: list[dict[str, object]], locale: str, generate: Callable[[str], str]) -> dict[str, dict[str, str]]:
    from backend.services.agent_behavior import task_input
    data = [{"id": str(s["id"]), "title": str(s.get("title") or ""), "why": str(s.get("why") or "")} for s in items]
    raw = generate(task_input("knowledge.localize", language=LANGUAGES[locale], proposals=data))
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    payload = json.loads(clean)
    rows = payload.get("translations") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError("Missing proposal translations")
    expected = {str(s["id"]) for s in items}
    translations: dict[str, dict[str, str]] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str) or row.get("id") not in expected or row.get("id") in translations:
            raise ValueError("Unexpected or repeated translated proposal")
        if not isinstance(row.get("title"), str) or not row["title"].strip() or not isinstance(row.get("why"), str):
            raise ValueError("Incomplete translated proposal")
        translations[str(row["id"])] = {"title": row["title"].strip(), "why": row["why"].strip()}
    if set(translations) != expected:
        raise ValueError("Not all proposals were translated")
    return translations
