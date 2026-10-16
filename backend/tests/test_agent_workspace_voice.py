"""Local voice transport tests never load Whisper weights or a live vault."""
import asyncio
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
import pytest

from backend.domains.agent.routes import workspace_voice as voice
from backend.services.workspace_service import WorkspaceContext

pytestmark = pytest.mark.usefixtures('isolated_validation_runtime')


def audio(data=b'bounded audio', mime='audio/webm'):
    return UploadFile(BytesIO(data), filename='voice.webm', headers=Headers({'content-type': mime}))


def context(tmp_path):
    return WorkspaceContext('workspace', 'user', 'editor', tmp_path / 'vault')


def test_transcription_uses_governed_public_entry_and_cleans_temporary_audio(tmp_path, monkeypatch):
    observed = []
    monkeypatch.setattr(voice.transcription, 'is_available', lambda: True)

    def transcribe(path, language=None):
        observed.append(Path(path))
        assert Path(path).read_bytes() == b'bounded audio'
        assert language == 'ca'
        return dict(text='Recognized prompt', language='ca', duration=4.0, segments=[])

    monkeypatch.setattr(voice.transcription, 'transcribe', transcribe)
    result = asyncio.run(voice.transcribe_workspace_voice(audio(), 'agent', 'session', 'ca-ES', context(tmp_path)))
    assert result.text == 'Recognized prompt'
    assert len(observed) == 1 and not observed[0].exists()


def test_transcription_failure_cleans_audio_and_preserves_policy_rejection(tmp_path, monkeypatch):
    observed = []
    monkeypatch.setattr(voice.transcription, 'is_available', lambda: True)

    def rejected(path, language=None):
        observed.append(Path(path))
        raise PermissionError('agent_execution_profile_revoked')

    monkeypatch.setattr(voice.transcription, 'transcribe', rejected)
    with pytest.raises(HTTPException) as error:
        asyncio.run(voice.transcribe_workspace_voice(audio(), 'agent', 'session', '', context(tmp_path)))
    assert error.value.status_code == 403
    assert observed and not observed[0].exists()


@pytest.mark.parametrize('data,mime,status', [(b'', 'audio/webm', 422), (b'a' * (voice.MAX_VOICE_BYTES + 1), 'audio/webm', 413), (b'a', 'text/plain', 415)])
def test_rejects_invalid_audio_before_local_inference(tmp_path, monkeypatch, data, mime, status):
    monkeypatch.setattr(voice.transcription, 'transcribe', lambda *args, **kwargs: pytest.fail('Invalid input reached inference'))
    with pytest.raises(HTTPException) as error:
        asyncio.run(voice.transcribe_workspace_voice(audio(data, mime), 'agent', 'session', 'en', context(tmp_path)))
    assert error.value.status_code == status


def test_unavailable_local_engine_does_not_start_inference(tmp_path, monkeypatch):
    monkeypatch.setattr(voice.transcription, 'is_available', lambda: False)
    with pytest.raises(HTTPException) as error:
        asyncio.run(voice.transcribe_workspace_voice(audio(), 'agent', 'session', '', context(tmp_path)))
    assert error.value.status_code == 503


def test_editor_role_is_required_by_route_contract():
    route = next(route for route in voice.router.routes if route.path == '/workspace/voice/transcribe')
    dependency = next(dependency for dependency in route.dependant.dependencies if dependency.name == 'context')
    with pytest.raises(HTTPException) as error:
        dependency.call(WorkspaceContext('workspace', 'user', 'viewer', Path('/synthetic/vault')))
    assert error.value.status_code == 403
