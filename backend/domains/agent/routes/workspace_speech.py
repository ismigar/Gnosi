"""Vault-wide speech preferences and playback through the same engine."""
from __future__ import annotations

import asyncio
from fastapi import Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.workspace import ScopeRequest, scope_for
from backend.services import workspace_speech as speech
from backend.services.workspace_service import WorkspaceContext, require_role


class WorkspaceSpeechRequest(ScopeRequest):
    text: str = Field(min_length=1, max_length=speech.MAX_TEXT_CHARS)
    language: speech.SpeechLanguage | None = None


class SpeechPreviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    language: speech.SpeechLanguage | None = None


SAMPLES = {'ca': 'Hola, aquesta és la veu que faré servir a Gnosi.',
           'en': 'Hello, this is the voice I will use throughout Gnosi.',
           'es': 'Hola, esta es la voz que usaré en Gnosi.',
           'fr': 'Bonjour, voici la voix que je vais utiliser dans Gnosi.'}


async def _watch_disconnect(request: Request) -> None:
    while not await request.is_disconnected():
        await asyncio.sleep(0.1)


async def _play(text: str, language: str, request: Request, context: WorkspaceContext, agent_id: str = '') -> Response:
    async def generate() -> tuple[bytes, str]:
        await asyncio.to_thread(speech.authorize_workspace_speech, context, agent_id)
        selected = await speech.effective_settings(language)
        effective_text = text or SAMPLES[speech.resolve_language(selected, language)]
        audio = await speech.synthesize_speech(text=effective_text, language=language, settings=selected)
        await asyncio.to_thread(speech.authorize_workspace_speech, context, agent_id)
        return audio, speech.revision(selected)

    task = asyncio.create_task(generate())
    disconnected = asyncio.create_task(_watch_disconnect(request))
    try:
        done, _ = await asyncio.wait({task, disconnected}, return_when=asyncio.FIRST_COMPLETED)
        if disconnected in done:
            raise HTTPException(499, 'Speech playback cancelled')
        audio, revision = await task
        return Response(audio, media_type='audio/mpeg', headers={'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'X-Gnosi-Speech-Revision': revision})
    except speech.SpeechDenied:
        raise HTTPException(403, 'Speech playback is not authorized') from None
    except speech.SpeechUnconfigured:
        raise HTTPException(503, 'Speech engine is unavailable or not configured') from None
    except speech.SpeechProviderFailure:
        raise HTTPException(502, 'Speech engine failed') from None
    except ValueError:
        raise HTTPException(422, 'Invalid speech input or settings') from None
    finally:
        task.cancel()
        disconnected.cancel()
        await asyncio.gather(task, disconnected, return_exceptions=True)


@router.get('/speech/settings', response_model=speech.SpeechSettingsResponse)
async def get_speech_settings(context: WorkspaceContext = Depends(require_role('editor'))) -> speech.SpeechSettingsResponse:
    return await speech.settings_response()


@router.put('/speech/settings', response_model=speech.SpeechSettingsResponse)
async def put_speech_settings(payload: speech.SpeechSettings, request: Request,
                              context: WorkspaceContext = Depends(require_role('admin'))) -> speech.SpeechSettingsResponse:
    from backend.domains.configuration.api import settings as configuration
    from backend.domains.configuration.settings_schemas import ConfigurationUpdateRequest
    try:
        await speech.validate_settings(payload)
    except ValueError:
        raise HTTPException(422, 'Selected voice is unavailable') from None
    await configuration.update_config(ConfigurationUpdateRequest({'ai': {'speech_output': payload.model_dump()}}), request)
    return await speech.settings_response()


_AUDIO_RESPONSE = {200: {'content': {'audio/mpeg': {'schema': {'type': 'string', 'format': 'binary'}}}}}


@router.post('/speech/preview', response_class=Response, responses=_AUDIO_RESPONSE)
async def preview_speech(payload: SpeechPreviewRequest, request: Request,
                         context: WorkspaceContext = Depends(require_role('editor'))) -> Response:
    return await _play('', payload.language or '', request, context)


@router.post('/workspace/voice/speak', response_class=Response, responses=_AUDIO_RESPONSE)
async def synthesize_workspace_speech(payload: WorkspaceSpeechRequest, request: Request,
                                      context: WorkspaceContext = Depends(require_role('editor'))) -> Response:
    scope_for(context, payload.agent_id, payload.session_id)
    return await _play(payload.text, payload.language or '', request, context, payload.agent_id)
