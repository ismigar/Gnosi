"""Typed AI content-generation routes used by the Vault editor."""

from backend.services.agent_behavior import task_input

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.utils.errors import safe_error_detail


router = APIRouter()


class GeneratePayload(BaseModel):
    prompt: str | None = ""
    context: str | None = ""
    mode: str | None = "free"
    language: str | None = None


class GenerateContentResponse(BaseModel):
    content: str
    provider: str


def build_generation_prompt(payload: GeneratePayload) -> str:
    instruction = (payload.prompt or "").strip()
    context = (payload.context or "").strip()
    mode = (payload.mode or "free").strip().lower()
    return task_input("translation.instructions" if mode == "translate_instructions" else
                      "translation.text" if mode == "translate" else f"writing.{mode}",
                      request=instruction, text=context or instruction,
                      language=(payload.language or "").strip())


def _execution_unavailable_detail(error: RuntimeError) -> str:
    code, _, skill = str(error).partition(":")
    if code == "plugin_profile_unavailable":
        return "The plugin profile is unavailable or missing its required skill. Check Settings › AI › Plugin profiles."
    if code == "principal_agent_unavailable":
        return "No active principal agent is configured. Check Settings › AI."
    if code == "principal_agent_model_unavailable":
        return "The selected profile's model is unavailable. Check Settings › AI."
    if code == "agent_skill_unavailable":
        return f"The selected profile is missing the required skill: {skill}. Check Settings › AI."
    return "No AI provider is available. Check Settings › AI."


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
    response_model=GenerateContentResponse,
)
async def generate_content(payload: GeneratePayload) -> dict[str, str]:
    """One-shot AI text generation to insert into Vault pages.

    The principal executor applies the assigned writing or translation skill,
    model policy and scoped memory, and records the resulting activity.
    """
    from functools import partial
    from backend.services.agent_execution import generate_for

    generate_text = partial(generate_for, "translation" if payload.mode in {"translate", "translate_instructions"} else "writing")

    final_prompt = build_generation_prompt(payload)
    if not ((payload.prompt or "").strip() or (payload.context or "").strip()):
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
            detail=_execution_unavailable_detail(error),
        ) from error
    except Exception as error:
        raise _provider_error(error, route="POST /ai/generate") from error

    return GenerateContentResponse(
        content=(content or "").strip(),
        provider=provider,
    ).model_dump()


class CorrectPayload(BaseModel):
    text: str
    language: str | None = None
    scope: str | None = "selection"


class CorrectTextResponse(BaseModel):
    corrected: str
    provider: str


_LANG_LABELS = {"ca": "Catalan", "es": "Spanish", "en": "English"}


@router.post(
    "/correct",
    response_model=CorrectTextResponse,
)
async def correct_text(payload: CorrectPayload) -> dict[str, str]:
    """Corrects spelling and grammar of a fragment using AI.

    Sibling of `/ai/generate` but with a strict contract: it returns ONLY the
    corrected text, preserving meaning, tone, language, and format. Meant to be applied to
    a selection, a block, or an entire editor page. Degrades with a 503 if there's
    no provider, never with a hard error.
    """
    from functools import partial
    from backend.services.agent_execution import generate_for

    generate_text = partial(generate_for, "writing")

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for correction.")

    hint = (payload.language or "").strip()
    language_note = f" The text is in {_LANG_LABELS.get(hint, hint)}." if hint else ""
    prompt = task_input("writing.correct", text=text, language=hint, scope=payload.scope)

    try:
        content, provider = await asyncio.to_thread(generate_text, prompt, text[:200])
    except RuntimeError as error:
        raise HTTPException(
            status_code=503,
            detail=_execution_unavailable_detail(error),
        ) from error
    except Exception as error:
        raise _provider_error(error, route="POST /ai/correct") from error

    return CorrectTextResponse(
        corrected=(content or "").strip(),
        provider=provider,
    ).model_dump()
