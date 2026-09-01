"""Typed AI content-generation routes used by the Vault editor."""

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.utils.errors import safe_error_detail


router = APIRouter()


class GeneratePayload(BaseModel):
    prompt: str | None = ""
    context: str | None = ""
    mode: str | None = "free"
    language: str | None = None


def build_generation_prompt(payload: GeneratePayload) -> str:
    """Build the final prompt according to the mode (Notion-style presets)."""
    instruction = (payload.prompt or "").strip()
    context = (payload.context or "").strip()
    mode = (payload.mode or "free").strip().lower()
    language = (payload.language or "").strip()

    style = (
        "Respond ONLY with the requested content in clean Markdown (headings, "
        "lists, **bold**, and tables where appropriate). Do not add an "
        "introduction such as “Here you go” or wrap the entire response in a "
        "code block. Keep the same language as the input text"
    )
    if mode == "translate" and language:
        style += f", except in this case: translate it into {language}."
    else:
        style += "."

    if mode == "continue":
        body = (
            "Continue the following text naturally and coherently by adding one "
            "or two new paragraphs. Do NOT repeat existing content.\n\n"
            f"--- CURRENT TEXT ---\n{context}"
        )
    elif mode == "summarize":
        body = (
            "Create a clear, structured summary of the following content, using "
            f"bullet points where appropriate.\n\n--- CONTENT ---\n{context}"
        )
    elif mode == "improve":
        target = context or instruction
        body = (
            "Rewrite the following text to improve its wording, clarity, and "
            "tone without changing its meaning or language.\n\n"
            f"--- TEXT ---\n{target}"
        )
    elif mode == "translate":
        target = context or instruction
        body = (
            f"Translate the following text faithfully into {language or 'English'}.\n\n"
            f"--- TEXT ---\n{target}"
        )
    elif context:
        body = (
            f"{instruction}\n\nUse this context from the current page as a "
            f"reference when needed:\n--- CONTEXT ---\n{context}"
        )
    else:
        body = instruction or "Write a useful paragraph about the topic."

    return f"{style}\n\n{body}"


def _provider_error(error: Exception, *, route: str) -> HTTPException:
    """Map provider failures to the stable editor-facing HTTP contract."""
    message = str(error).lower()
    if any(marker in message for marker in ("timeout", "timed out", "timed_out")):
        return HTTPException(
            status_code=504,
            detail="The AI provider did not respond in time. Try again.",
        )
    auth_markers = (
        "authentication",
        "api key",
        "api_key",
        "invalid_api_key",
        "unauthor",
        "permission",
        "401",
        "403",
    )
    if any(marker in message for marker in auth_markers):
        return HTTPException(
            status_code=503,
            detail="The AI provider rejected the key. Check Settings › AI.",
        )
    return HTTPException(
        status_code=502,
        detail=safe_error_detail(error, context=route),
    )


@router.post(
    "/generate",
    response_model=None,
    responses={200: {"content": {"application/json": {"schema": {}}}}},
)
async def generate_content(payload: GeneratePayload) -> Any:
    """One-shot AI text generation to insert into Vault pages.

    Uses the MODERN path `factory.generate_text` (get_llm + resolve_provider_api_key),
    the same one used by the agent and the «validate» button in Settings › AI. Each call is
    fresh (no caching), so calling «keep writing» twice gives different text.
    Degrades with 503 if no provider is available, never with a hard
    error.
    """
    from backend.agent.factory import generate_text

    final_prompt = build_generation_prompt(payload)
    if not final_prompt.strip() or final_prompt.strip() == ".":
        raise HTTPException(status_code=400, detail="A prompt or context is required.")

    try:
        content, provider = await asyncio.to_thread(
            generate_text,
            final_prompt,
            payload.prompt or "",
        )
    except RuntimeError as error:
        raise HTTPException(
            status_code=503,
            detail="No AI provider is available. Check Settings › AI.",
        ) from error
    except Exception as error:
        raise _provider_error(error, route="POST /ai/generate") from error

    return {"content": (content or "").strip(), "provider": provider}


class CorrectPayload(BaseModel):
    text: str
    language: str | None = None
    scope: str | None = "selection"


_LANG_LABELS = {"ca": "Catalan", "es": "Spanish", "en": "English"}


@router.post(
    "/correct",
    response_model=None,
    responses={200: {"content": {"application/json": {"schema": {}}}}},
)
async def correct_text(payload: CorrectPayload) -> Any:
    """Corrects spelling and grammar of a fragment using AI.

    Sibling of `/ai/generate` but with a strict contract: it returns ONLY the
    corrected text, preserving meaning, tone, language, and format. Meant to be applied to
    a selection, a block, or an entire editor page. Degrades with a 503 if there's
    no provider, never with a hard error.
    """
    from backend.agent.factory import generate_text

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for correction.")

    hint = (payload.language or "").strip()
    language_note = f" The text is in {_LANG_LABELS.get(hint, hint)}." if hint else ""
    prompt = (
        "You are a spelling and grammar checker. Correct spelling, diacritics, "
        "punctuation, agreement, and grammar in the following text."
        f"{language_note} Preserve EXACTLY the same language, meaning, tone, and register. "
        "Do not rewrite the style, summarize, add, or remove ideas. Preserve "
        "Markdown formatting, line breaks, [[wiki]] links, URLs, and code exactly. "
        "Respond ONLY with the corrected text, without quotation marks, "
        "explanations, or comments.\n\n"
        f"--- TEXT ---\n{text}"
    )

    try:
        content, provider = await asyncio.to_thread(generate_text, prompt, text[:200])
    except RuntimeError as error:
        raise HTTPException(
            status_code=503,
            detail="No AI provider is available. Check Settings › AI.",
        ) from error
    except Exception as error:
        raise _provider_error(error, route="POST /ai/correct") from error

    return {"corrected": (content or "").strip(), "provider": provider}
