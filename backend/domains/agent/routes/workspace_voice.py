"""Bounded voice chunks through the existing governed local transcription engine."""
from __future__ import annotations

import asyncio
from pathlib import Path
import re
import tempfile

from fastapi import Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.domains.agent.routes.router import router
from backend.services import transcription
from backend.services.workspace_service import WorkspaceContext, require_role

MAX_VOICE_BYTES = 4 * 1024 * 1024
_AUDIO_SUFFIXES = {'audio/webm': '.webm', 'video/webm': '.webm', 'audio/mp4': '.mp4', 'video/mp4': '.mp4', 'audio/ogg': '.ogg'}


class WorkspaceVoiceTranscript(BaseModel):
    text: str = Field(max_length=16000)
    language: str | None = None
    duration: float


def _transcribe_chunk(data: bytes, suffix: str, language: str | None) -> WorkspaceVoiceTranscript:
    """The worker owns cleanup even if its HTTP waiter disconnects."""
    audio = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    temporary_path = Path(audio.name)
    try:
        with audio:
            audio.write(data)
        # Public entry point enforces run_engine membership, profile and skill policy.
        result = transcription.transcribe(str(temporary_path), language=language)
        return WorkspaceVoiceTranscript(text=result['text'][:16000], language=result['language'], duration=result['duration'])
    finally:
        temporary_path.unlink(missing_ok=True)


@router.post('/workspace/voice/transcribe', response_model=WorkspaceVoiceTranscript)
async def transcribe_workspace_voice(
    audio: UploadFile = File(...),
    agent_id: str = Form(...),
    session_id: str = Form(...),
    language: str = Form(default=''),
    context: WorkspaceContext = Depends(require_role('editor')),
) -> WorkspaceVoiceTranscript:
    """Transcribe an explicitly recorded chunk locally; weights may download on first use."""
    from backend.domains.agent.routes.workspace import scope_for
    scope_for(context, agent_id, session_id)
    suffix = _AUDIO_SUFFIXES.get((audio.content_type or '').split(';')[0].lower())
    if suffix is None:
        raise HTTPException(415, 'Unsupported voice recording format')
    normalized_language = language.strip().lower().split('-')[0]
    if normalized_language and not re.fullmatch('[a-z]{2,3}', normalized_language):
        raise HTTPException(422, 'Invalid voice language')
    data = await audio.read(MAX_VOICE_BYTES + 1)
    if len(data) > MAX_VOICE_BYTES:
        raise HTTPException(413, 'Voice recording exceeds 4 MB')
    if not data:
        raise HTTPException(422, 'Voice recording is empty')
    if not transcription.is_available():
        raise HTTPException(503, 'Local transcription is unavailable')
    try:
        return await asyncio.to_thread(_transcribe_chunk, data, suffix, normalized_language or None)
    except PermissionError:
        raise HTTPException(403, 'Local transcription is not authorized') from None
