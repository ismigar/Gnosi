"""One Vault-scoped speech engine for live playback and generated audio.

External processing is enabled only by the central saved preference. Agent
artifact callers retain their existing skill, scope and confirmation guards.
"""
from __future__ import annotations

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import html
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
from typing import Literal, Self

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing_extensions import Buffer

from backend.config.app_config import load_params
from backend.security.ai_credentials import has_provider_api_key, resolve_provider_api_key
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import revalidate_scope
from backend.services.workspace_service import WorkspaceContext

SpeechLanguage = Literal['ca', 'en', 'es', 'fr']
LANGUAGES = {'ca': 'Catalan', 'en': 'English', 'es': 'Spanish', 'fr': 'French'}
NOVELTY_VOICES = frozenset({'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged',
                          'good news', 'hysterical', 'organ', 'trinoids', 'whisper', 'wobble', 'zarvox', 'jester'})
SPEECH_ENDPOINT = 'https://api.openai.com/v1/audio/speech'
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_TEXT_CHARS = 4096
MAX_DOCUMENT_CHARS = 200_000
MAX_DOCUMENT_AUDIO_BYTES = 256 * 1024 * 1024
SPEECH_TIMEOUT_SECONDS = 90
_ENCODER_SLOT = threading.BoundedSemaphore(1)


class SpeechSettings(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)
    provider: Literal['local', 'openai'] = 'local'
    voice: str = Field(default='auto', min_length=1, max_length=160)
    language: Literal['auto', 'ca', 'en', 'es', 'fr'] = 'auto'
    speed: float = Field(default=1.0, ge=0.5, le=2.0, allow_inf_nan=False)

    @model_validator(mode='after')
    def validate_voice(self) -> Self:
        if self.provider == 'openai' and self.voice not in {'auto', 'marin', 'cedar'}:
            raise ValueError('Invalid neural voice')
        return self


_selected: ContextVar[SpeechSettings | None] = ContextVar('speech_settings', default=None)


@contextmanager
def speech_session(settings: SpeechSettings) -> Iterator[None]:
    token = _selected.set(settings)
    try:
        yield
    finally:
        _selected.reset(token)


class SpeechVoice(BaseModel):
    id: str
    language: str


class SpeechSettingsResponse(BaseModel):
    settings: SpeechSettings
    revision: str
    local_available: bool
    local_voices: list[SpeechVoice]
    openai_configured: bool


class SpeechDenied(Exception):
    """The selected presentation action is not authorized."""


class SpeechUnconfigured(Exception):
    """The saved speech engine is unavailable or unconfigured."""


class SpeechProviderFailure(Exception):
    """The selected engine did not produce complete bounded audio."""


def get_settings() -> SpeechSettings:
    selected = _selected.get()
    if selected is not None:
        return selected
    return SpeechSettings.model_validate(load_params(strict_env=False).ai.get('speech_output') or {})


def revision(settings: SpeechSettings, language: str = '') -> str:
    engine = 'gpt-4o-mini-tts' if settings.provider == 'openai' else 'macos-say-pyav-v1'
    return hashlib.sha256(json.dumps({'settings': settings.model_dump(), 'engine': engine,
                                     'language': language}, sort_keys=True).encode()).hexdigest()


def fingerprint(text: str, language: str, settings: SpeechSettings | None = None) -> str:
    selected = effective_settings_sync(language, settings)
    return hashlib.sha256((revision(selected, selected.language) + '\0' + text).encode()).hexdigest()


def resolve_language(settings: SpeechSettings, hint: str = '') -> str:
    if settings.language != 'auto':
        return settings.language
    normalized = hint.lower().split('-')[0]
    if normalized in LANGUAGES:
        return normalized
    value = str(load_params(strict_env=False).settings.get('language', 'en')).split('-')[0]
    return value if value in LANGUAGES else 'en'


def authorize_workspace_speech(context: WorkspaceContext, agent_id: str = '') -> None:
    if context.role not in {'editor', 'admin', 'owner'}:
        raise SpeechDenied()
    scope = ExecutionScope.model_validate(dict(user_id=context.user_id, workspace_id=context.workspace_id,
                                               role=context.role, vault_path=str(context.vault_path.resolve())))
    try:
        revalidate_scope(scope)
    except PermissionError:
        raise SpeechDenied() from None
    if agent_id:
        agents = load_params(strict_env=False).ai.get('agents', [])
        profile = next((item for item in agents if item.get('id') == agent_id), None)
        if profile is None or not profile.get('enabled', True):
            raise SpeechDenied()


def _provider_key() -> str:
    cfg = load_params(strict_env=False).ai.get('providers', {}).get('openai')
    if not isinstance(cfg, dict):
        raise SpeechUnconfigured()
    if not cfg.get('enabled', True):
        raise SpeechDenied()
    key = resolve_provider_api_key('openai', cfg)
    if not key:
        raise SpeechUnconfigured()
    return key


async def _say(args: list[str], text: bytes | None = None, timeout: float = 15) -> bytes:
    if sys.platform != 'darwin' or not Path('/usr/bin/say').is_file():
        raise SpeechUnconfigured()
    process = await asyncio.create_subprocess_exec('/usr/bin/say', *args,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(text), timeout)
        if process.returncode != 0 or len(stdout) > 128 * 1024:
            raise SpeechProviderFailure()
        return stdout
    except BaseException:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await process.wait()
        raise


async def local_voices() -> list[SpeechVoice]:
    if sys.platform != 'darwin' or not Path('/usr/bin/say').is_file():
        return []
    output = await _say(['-v', '?'])
    result = []
    for line in output.decode('utf-8', errors='replace').splitlines():
        match = re.match(r'^(.+?)\s+([a-z]{2,3}_[A-Za-z_]+)\s+#', line)
        if match:
            result.append(SpeechVoice(id=match[1].strip(), language=match[2].replace('_', '-')))
    # macOS may repeat the same selector/language for installed variants.
    # The name remains invokable, but does not identify the quality variant.
    unique = {(voice.id, voice.language): voice for voice in result}
    return list(unique.values())


async def effective_settings(language: str = '', settings: SpeechSettings | None = None) -> SpeechSettings:
    """Freeze the actual voice/language once, before hashing or synthesizing."""
    selected: SpeechSettings = settings if settings is not None else await asyncio.to_thread(get_settings)
    effective_language = resolve_language(selected, language)
    voices = await local_voices() if selected.provider == 'local' and selected.voice == 'auto' else []
    return _resolved_settings(selected, effective_language, voices)


def _resolved_settings(selected: SpeechSettings, effective_language: str, voices: list[SpeechVoice]) -> SpeechSettings:
    voice = selected.voice
    if voice == 'auto':
        if selected.provider == 'openai':
            voice = 'marin'
        else:
            matching = [item for item in voices if item.language.split('-')[0] == effective_language
                        and item.id.casefold() not in NOVELTY_VOICES]
            matching.sort(key=lambda item: ('premium' not in item.id.casefold(), 'enhanced' not in item.id.casefold()))
            if not matching:
                raise SpeechUnconfigured()
            voice = matching[0].id
    return SpeechSettings.model_validate(dict(provider=selected.provider, voice=voice,
                                               language=effective_language, speed=selected.speed))


def effective_settings_sync(language: str = '', settings: SpeechSettings | None = None) -> SpeechSettings:
    """Resolve only from synchronous governed workers, never an event loop."""
    selected = settings or get_settings()
    if selected.voice != 'auto' and selected.language != 'auto':
        return selected
    return asyncio.run(effective_settings(language, selected))


async def validate_settings(settings: SpeechSettings) -> None:
    if settings.provider == 'openai':
        if settings.voice not in {'auto', 'marin', 'cedar'}:
            raise ValueError('Invalid neural voice')
        # Saving an explicit external preference never probes the provider.
        return
    if settings.voice != 'auto' and settings.voice not in {voice.id for voice in await local_voices()}:
        raise ValueError('Local voice is not installed')


async def settings_response() -> SpeechSettingsResponse:
    selected = await asyncio.to_thread(get_settings)
    try:
        voices = await local_voices()
    except (SpeechUnconfigured, SpeechProviderFailure, OSError, TimeoutError):
        voices = []
    cfg = await asyncio.to_thread(load_params, strict_env=False)
    provider = cfg.ai.get('providers', {}).get('openai') or {}
    ready = bool(provider and provider.get('enabled', True)) and await asyncio.to_thread(has_provider_api_key, 'openai', provider)
    try:
        effective = _resolved_settings(selected, resolve_language(selected), voices)
    except SpeechUnconfigured:
        effective = selected
    return SpeechSettingsResponse(settings=selected, revision=revision(effective), local_available=bool(voices),
                                  local_voices=voices, openai_configured=ready)


async def _neural(text: str, language: str, selected: SpeechSettings) -> bytes:
    key = await asyncio.to_thread(_provider_key)
    voice = 'marin' if selected.voice == 'auto' else selected.voice
    if voice not in {'marin', 'cedar'}:
        raise SpeechUnconfigured()
    body = {'model': 'gpt-4o-mini-tts', 'input': text, 'voice': voice, 'response_format': 'mp3',
            'speed': selected.speed,
            'instructions': f'Speak in {LANGUAGES[language]} with natural conversational phrasing and a warm, clear tone. Preserve the supplied meaning.'}
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=False, trust_env=False) as client:
        async with client.stream('POST', SPEECH_ENDPOINT, headers={'Authorization': f'Bearer {key}'}, json=body) as response:
            if response.status_code != 200 or response.headers.get('content-type', '').split(';')[0] not in {'audio/mpeg', 'audio/mp3'}:
                raise SpeechProviderFailure()
            audio = bytearray()
            async for chunk in response.aiter_bytes():
                if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
                    raise SpeechProviderFailure()
                audio.extend(chunk)
            if not audio:
                raise SpeechProviderFailure()
            return bytes(audio)


async def _encode_mp3(aiff: bytes, cancelled: threading.Event, deadline: float) -> bytes:
    """Cooperative live encoding, owned and awaited directly by its request.

    A yield between frames lets cancellation close both containers before the
    request completes. No executor worker survives cancellation or timeout.
    """
    import av

    class BoundedBuffer(io.BytesIO):
        def write(self, data: Buffer, /) -> int:
            if self.tell() + memoryview(data).nbytes > MAX_AUDIO_BYTES:
                raise SpeechProviderFailure()
            return super().write(data)

    def check() -> None:
        if cancelled.is_set() or time.monotonic() >= deadline:
            raise SpeechProviderFailure()

    if not _ENCODER_SLOT.acquire(blocking=False):
        raise SpeechProviderFailure()
    try:
        output = BoundedBuffer()
        with av.open(io.BytesIO(aiff), mode='r') as source, av.open(output, mode='w', format='mp3') as destination:
            stream = destination.add_stream('libmp3lame', rate=24000)
            stream.layout = 'mono'
            stream.codec_context.format = 'fltp'
            resampler = av.AudioResampler(format='fltp', layout='mono', rate=24000)
            for frame in source.decode(audio=0):
                check()
                await asyncio.sleep(0)
                if not isinstance(frame, av.AudioFrame):
                    raise SpeechProviderFailure()
                for converted in resampler.resample(frame):
                    check()
                    for packet in stream.encode(converted):
                        check()
                        destination.mux(packet)
            for converted in resampler.resample(None):
                check()
                for packet in stream.encode(converted):
                    check()
                    destination.mux(packet)
            for packet in stream.encode(None):
                check()
                destination.mux(packet)
        return output.getvalue()
    finally:
        _ENCODER_SLOT.release()


class _BoundedAudioFile(io.BufferedWriter):
    def __init__(self, path: str | Path) -> None:
        super().__init__(io.FileIO(str(path), mode='w'))

    def write(self, data: Buffer, /) -> int:
        if self.tell() + memoryview(data).nbytes > MAX_DOCUMENT_AUDIO_BYTES:
            raise SpeechProviderFailure()
        return super().write(data)


def _write_document_mp3(chunks: list[bytes], output_path: str | Path,
                        cancelled: threading.Event | None = None) -> None:
    """Encode one coherent stream, avoiding concatenated MP3 seek headers."""
    if not _ENCODER_SLOT.acquire(blocking=False):
        raise SpeechProviderFailure()
    deadline = time.monotonic() + SPEECH_TIMEOUT_SECONDS

    def check() -> None:
        if (cancelled is not None and cancelled.is_set()) or time.monotonic() >= deadline:
            raise SpeechProviderFailure()

    try:
        import av
        with _BoundedAudioFile(output_path) as output, av.open(output, mode='w', format='mp3') as destination:
            stream = destination.add_stream('libmp3lame', rate=24000)
            stream.layout = 'mono'
            stream.codec_context.format = 'fltp'
            for chunk in chunks:
                resampler = av.AudioResampler(format='fltp', layout='mono', rate=24000)
                with av.open(io.BytesIO(chunk), mode='r') as source:
                    for frame in source.decode(audio=0):
                        check()
                        if not isinstance(frame, av.AudioFrame):
                            raise SpeechProviderFailure()
                        frame.pts = None
                        for converted in resampler.resample(frame):
                            check()
                            for packet in stream.encode(converted):
                                check()
                                destination.mux(packet)
                    for converted in resampler.resample(None):
                        check()
                        for packet in stream.encode(converted):
                            check()
                            destination.mux(packet)
            for packet in stream.encode(None):
                check()
                destination.mux(packet)
        if not 0 < Path(output_path).stat().st_size <= MAX_DOCUMENT_AUDIO_BYTES:
            raise SpeechProviderFailure()
    except ImportError:
        raise SpeechUnconfigured() from None
    except Exception:
        raise SpeechProviderFailure() from None
    finally:
        _ENCODER_SLOT.release()


async def _local(text: str, language: str, selected: SpeechSettings) -> bytes:
    if selected.voice == 'auto':
        raise SpeechUnconfigured()
    cancelled = threading.Event()
    deadline = time.monotonic() + SPEECH_TIMEOUT_SECONDS
    with tempfile.TemporaryDirectory(prefix='gnosi-speech-') as temporary:
        path = Path(temporary) / 'speech.aiff'
        try:
            await _say(['-v', selected.voice, '-r', str(round(175 * selected.speed)), '-o', str(path), '--file-format=AIFF'],
                       text.encode('utf-8'), timeout=75)
            if not path.is_file() or not 0 < path.stat().st_size <= 64 * 1024 * 1024:
                raise SpeechProviderFailure()
            return await _encode_mp3(path.read_bytes(), cancelled, deadline)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        except (SpeechUnconfigured, SpeechDenied, SpeechProviderFailure):
            raise
        except ImportError:
            raise SpeechUnconfigured() from None
        except Exception:
            raise SpeechProviderFailure() from None


async def synthesize_speech(*, text: str, language: str = '', settings: SpeechSettings | None = None) -> bytes:
    if not text.strip() or len(text) > MAX_TEXT_CHARS:
        raise ValueError('Invalid speech input')
    text = spoken_text(text)
    if not text:
        raise ValueError('No spoken prose')
    selected = await effective_settings(language, settings)
    effective_language = resolve_language(selected, language)
    try:
        async with asyncio.timeout(SPEECH_TIMEOUT_SECONDS):
            audio = await (_neural(text, effective_language, selected) if selected.provider == 'openai' else _local(text, effective_language, selected))
            if not audio or len(audio) > MAX_AUDIO_BYTES:
                raise SpeechProviderFailure()
            return audio
    except ImportError:
        raise SpeechUnconfigured() from None
    except (httpx.HTTPError, OSError, TimeoutError):
        raise SpeechProviderFailure() from None


def spoken_text(text: str) -> str:
    """Speak prose consistently without Markdown syntax, code or link targets."""
    text = re.sub(r'(```|~~~)[^\n]*\n.*?(?:\1|$)', '\n', text, flags=re.DOTALL)
    text = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'https?://\S+', '', text)
    text = re.sub(r'<[^>]*>', '', text)
    text = re.sub(r'^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\|?\s*:?-{3,}[^\n]*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'\[(?:\d+(?:\s*[,;-]\s*\d+)*|\^[^\]]+)\]', '', text)
    text = re.sub(r'[*_`~]', '', text)
    text = re.sub(r'\s*\|\s*', ', ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return html.unescape(re.sub(r'\n\s*\n+', '\n', text)).strip()


def generate_document(text: str, output_path: str | Path, language: str) -> None:
    """Sequential bounded synthesis, shared by both governed artifact callers."""
    if not text.strip() or len(text) > MAX_DOCUMENT_CHARS:
        raise ValueError('Invalid speech document')
    text = spoken_text(text)
    if not text:
        raise ValueError('No spoken prose')
    selected = effective_settings_sync(language)
    # Greedy sentence boundaries, with hard splits for oversized single sentences.
    chunks: list[str] = []
    for sentence in re.split(r'(?<=[.!?…])\s+', text.strip()):
        while len(sentence) > MAX_TEXT_CHARS:
            boundary = sentence.rfind(' ', 0, MAX_TEXT_CHARS) or MAX_TEXT_CHARS
            if boundary < 1:
                boundary = MAX_TEXT_CHARS
            chunks.append(sentence[:boundary])
            sentence = sentence[boundary:].lstrip()
        if sentence:
            if chunks and len(chunks[-1]) + len(sentence) + 1 <= MAX_TEXT_CHARS:
                chunks[-1] += ' ' + sentence
            else:
                chunks.append(sentence)

    async def generate() -> None:
        audio_chunks = []
        size = 0
        for chunk in chunks:
            audio = await synthesize_speech(text=chunk, language=language, settings=selected)
            size += len(audio)
            if size > MAX_DOCUMENT_AUDIO_BYTES:
                raise SpeechProviderFailure()
            audio_chunks.append(audio)
        cancelled = threading.Event()
        try:
            await asyncio.to_thread(_write_document_mp3, audio_chunks, output_path, cancelled)
        except asyncio.CancelledError:
            cancelled.set()
            raise
    asyncio.run(generate())
