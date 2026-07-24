"""AI layer for composing social media posts.

Given source content (title + body + optional URL) and a list of networks,
it generates ONE text proposal adapted to each network: it respects the
character limit, the configured tone, and the default hashtags, and —importantly—
it ALWAYS writes in the SAME LANGUAGE as the original content (it never translates).

It doesn't publish anything: it only generates proposals for the user to review/edit.
The actual publishing is done by `social_clients` via the `/api/social/publish` endpoint.
"""
import re
import logging
from typing import Dict, List, Optional, Any

log = logging.getLogger(__name__)

# Language name IN THE LANGUAGE ITSELF so the model anchors to it well.
LANG_NAMES = {
    "ca": "català",
    "es": "español",
    "en": "English",
    "fr": "français",
    "de": "Deutsch",
    "it": "italiano",
    "pt": "português",
    "nl": "Nederlands",
    "eu": "euskara",
    "gl": "galego",
}


def detect_lang(text: str) -> str:
    """Detect the ISO 639-1 language of the source content (default: English).

    Reuses the heuristic from the translate_row skill (a pure function, with no
    dependency on the backend). Falls back to English if it cannot be imported.
    
    """
    try:
        from pipeline.skills.translate_row.scripts.translate_text import detect_source_lang
        return detect_source_lang(text or "")
    except Exception as exc:  # pragma: no cover - clean degradation
        log.warning("social_compose: detect_source_lang unavailable (%s); assuming 'en'", exc)
        return "en"


def build_prompt(
    *,
    content: str,
    title: str,
    url: str,
    network: str,
    char_limit: int,
    tone: str,
    hashtags_default: str,
    source_lang: str,
    hint: str,
    variation: int = 0,
) -> str:
    """Builds the prompt for a specific network."""
    lang_name = LANG_NAMES.get(source_lang, source_lang)
    parts: List[str] = [
        f"You are an expert community manager. Write ONE post for {network}.",
        f"REQUIRED output language: {lang_name} ({source_lang}). Do not translate it into another language; "
        f"write in the same language as the source content.",
        f"Strict limit: at most {char_limit} total characters, including hashtags and the link.",
    ]
    if tone:
        parts.append(f"Tone and voice: {tone}.")
    if hashtags_default:
        parts.append(f"Include 1–3 relevant hashtags at the end; prioritize these when appropriate: {hashtags_default}.")
    else:
        parts.append("Include 1–3 relevant hashtags at the end.")
    if url:
        parts.append(f"You may finish with this link: {url}")
    if hint:
        parts.append(f"Additional user instruction: {hint}")
    if variation:
        parts.append(f"Propose an alternative that is CLEARLY DIFFERENT from the previous ones (variation #{variation}).")
    parts.append("Return ONLY the final post text, without quotation marks, headings, or explanations.")
    parts.append("")
    parts.append(f"TITLE: {title}".strip())
    parts.append(f"CONTENT:\n{content}".strip())
    return "\n".join(p for p in parts if p is not None)


def _clean_output(raw: str) -> str:
    """Cleans up the model output: common wrapping spaces and quotes."""
    text = (raw or "").strip()
    # Strips a full wrapper of quotes (" ... " or ' ... ' or ``` ... ```).
    for fence in ("```", '"""', "'''"):
        if text.startswith(fence) and text.endswith(fence) and len(text) > 2 * len(fence):
            text = text[len(fence):-len(fence)].strip()
    if len(text) >= 2 and text[0] in "\"'“”" and text[-1] in "\"'“”":
        text = text[1:-1].strip()
    return text


def _extract_hashtags(text: str) -> List[str]:
    """Extracts the hashtags from the text (to show them separately in the UI)."""
    return re.findall(r"#\w+", text or "")


def compose_one(
    *,
    network: str,
    char_limit: int,
    content: str,
    title: str,
    url: str,
    source_lang: str,
    tone: str = "",
    hashtags_default: str = "",
    hint: str = "",
    variation: int = 0,
) -> Dict[str, Any]:
    """Generates the proposal for ONE network. Synchronous (the endpoint wraps it in to_thread).

    Returns {text, hashtags, char_count, over_limit, provider}.
    
    """
    from pipeline.ai_client import call_ai_with_fallback

    prompt = build_prompt(
        content=content,
        title=title,
        url=url,
        network=network,
        char_limit=char_limit,
        tone=tone,
        hashtags_default=hashtags_default,
        source_lang=source_lang,
        hint=hint,
        variation=variation,
    )
    raw, provider = call_ai_with_fallback(prompt)
    text = _clean_output(raw)
    return {
        "text": text,
        "hashtags": _extract_hashtags(text),
        "char_count": len(text),
        "over_limit": len(text) > char_limit,
        "provider": provider,
    }
