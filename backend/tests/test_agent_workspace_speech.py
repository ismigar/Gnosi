"""Synthetic unified speech checks, without native encoders or provider calls."""
import asyncio
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
import httpx
from pydantic import ValidationError
import pytest

from backend.domains.agent.routes import workspace_speech as route
from backend.services import workspace_speech as speech
from backend.services.workspace_service import WorkspaceContext

pytestmark = pytest.mark.usefixtures('isolated_validation_runtime')
_REAL_LOCAL_VOICES = speech.local_voices


@pytest.fixture
def configured(monkeypatch):
    cfg = SimpleNamespace(ai={'agents': [{'id': 'agent', 'enabled': True}],
                              'providers': {'openai': {'enabled': True, 'base_url': 'https://untrusted.invalid'}}},
                          settings={'language': 'en'})
    monkeypatch.setattr(speech, 'load_params', lambda **kwargs: cfg)
    monkeypatch.setattr(speech, 'resolve_provider_api_key', lambda *args: 'synthetic-key')
    monkeypatch.setattr(speech, 'has_provider_api_key', lambda *args: True)
    monkeypatch.setattr(speech, 'revalidate_scope', lambda scope: None)
    async def voices():
        return [speech.SpeechVoice(id='Installed Voice', language='ca-ES'),
                speech.SpeechVoice(id='English Voice', language='en-US'),
                speech.SpeechVoice(id='French Voice', language='fr-FR')]
    monkeypatch.setattr(speech, 'local_voices', voices)
    return cfg


def payload(**changes):
    values = dict(agent_id='agent', session_id='session', text='Synthetic sentence.', language='ca')
    values.update(changes)
    return route.WorkspaceSpeechRequest(**values)


class Connected:
    async def is_disconnected(self):
        return False


def context(tmp_path):
    return WorkspaceContext('workspace', 'user', 'editor', tmp_path / 'vault')


def mock_provider(monkeypatch, handler):
    client = httpx.AsyncClient
    def factory(**kwargs):
        assert kwargs['follow_redirects'] is False and kwargs['trust_env'] is False
        return client(**kwargs, transport=httpx.MockTransport(handler))
    monkeypatch.setattr(speech.httpx, 'AsyncClient', factory)


def test_default_engine_is_local_and_no_network(configured, monkeypatch):
    calls = []
    async def local(text, language, selected):
        calls.append((language, selected.provider))
        return b'local mp3'
    monkeypatch.setattr(speech, '_local', local)
    mock_provider(monkeypatch, lambda request: pytest.fail('Default must not send text externally'))
    assert asyncio.run(speech.synthesize_speech(text='Synthetic', language='ca')) == b'local mp3'
    assert calls == [('ca', 'local')]


def test_central_neural_settings_and_fixed_endpoint(tmp_path, configured, monkeypatch):
    configured.ai['speech_output'] = dict(provider='openai', voice='cedar', language='fr', speed=1.25)
    calls = []
    def provider(request):
        import json
        calls.append(request)
        assert str(request.url) == speech.SPEECH_ENDPOINT
        assert request.headers['authorization'] == 'Bearer synthetic-key'
        body = json.loads(request.content)
        assert body['model'] == 'gpt-4o-mini-tts' and body['voice'] == 'cedar'
        assert body['speed'] == 1.25 and 'French' in body['instructions']
        return httpx.Response(200, headers={'content-type': 'audio/mpeg'}, content=b'synthetic mp3')
    mock_provider(monkeypatch, provider)
    result = asyncio.run(route.synthesize_workspace_speech(payload(), Connected(), context(tmp_path)))
    assert result.body == b'synthetic mp3' and result.headers['cache-control'] == 'no-store'
    assert result.headers['x-gnosi-speech-revision'] == speech.revision(speech.get_settings())
    assert len(calls) == 1 and not (tmp_path / 'vault').exists()


@pytest.mark.parametrize('extra', [{'provider': 'openai'}, {'voice': 'cedar'}, {'speed': 1.2}])
def test_chat_cannot_override_central_settings(extra):
    with pytest.raises(ValidationError):
        payload(**extra)


@pytest.mark.parametrize('settings', [{'speed': float('nan')}, {'speed': 3}, {'provider': 'gtts'},
                                     {'provider': 'openai', 'voice': 'unknown'}])
def test_invalid_central_settings(settings):
    with pytest.raises(ValidationError):
        speech.SpeechSettings(**settings)


@pytest.mark.parametrize('failure,status', [('agent', 403), ('missing-agent', 403), ('provider', 403),
                                           ('key', 503), ('missing-provider', 503), ('membership', 403)])
def test_denial_and_unconfigured_are_distinct(tmp_path, configured, monkeypatch, failure, status):
    configured.ai['speech_output'] = dict(provider='openai')
    if failure == 'agent':
        configured.ai['agents'][0]['enabled'] = False
    elif failure == 'missing-agent':
        configured.ai['agents'] = []
    elif failure == 'provider':
        configured.ai['providers']['openai']['enabled'] = False
    elif failure == 'missing-provider':
        configured.ai['providers'] = {}
    elif failure == 'key':
        monkeypatch.setattr(speech, 'resolve_provider_api_key', lambda *args: None)
    else:
        def deny(scope):
            raise PermissionError('synthetic denial')
        monkeypatch.setattr(speech, 'revalidate_scope', deny)
    mock_provider(monkeypatch, lambda request: pytest.fail('Denied request reached provider'))
    with pytest.raises(HTTPException) as error:
        asyncio.run(route.synthesize_workspace_speech(payload(), Connected(), context(tmp_path)))
    assert error.value.status_code == status


@pytest.mark.parametrize('status,kind,body', [(302, 'audio/mpeg', b'a'), (429, 'application/json', b'private'),
                                            (200, 'text/plain', b'wrong'), (200, 'audio/mpeg', b'')])
def test_provider_failure_no_retry_no_body_leak(configured, monkeypatch, status, kind, body):
    configured.ai['speech_output'] = dict(provider='openai')
    calls = []
    def provider(request):
        calls.append(request)
        return httpx.Response(status, headers={'content-type': kind}, content=body)
    mock_provider(monkeypatch, provider)
    with pytest.raises(speech.SpeechProviderFailure) as error:
        asyncio.run(speech.synthesize_speech(text='Synthetic'))
    assert str(error.value) == '' and len(calls) == 1


def test_nonmac_local_is_explicitly_unavailable(configured, monkeypatch):
    monkeypatch.setattr(speech.sys, 'platform', 'linux')
    mock_provider(monkeypatch, lambda request: pytest.fail('No cloud fallback is allowed'))
    with pytest.raises(speech.SpeechUnconfigured):
        asyncio.run(speech.synthesize_speech(text='Synthetic'))


def test_native_stdin_and_private_file_cleanup(configured, monkeypatch):
    paths = []
    async def voices():
        return [speech.SpeechVoice(id='Installed Voice', language='ca-ES')]
    async def say(args, text=None, timeout=15):
        assert args[args.index('-v') + 1] == 'Installed Voice'
        assert text == b'Synthetic; $(private)'
        path = Path(args[args.index('-o') + 1])
        paths.append(path)
        assert path.parent.stat().st_mode & 0o777 == 0o700
        path.write_bytes(b'synthetic aiff')
        return b''
    monkeypatch.setattr(speech, 'local_voices', voices)
    monkeypatch.setattr(speech, '_say', say)
    async def encode(data, cancelled, deadline):
        return b'synthetic mp3'
    monkeypatch.setattr(speech, '_encode_mp3', encode)
    assert asyncio.run(speech.synthesize_speech(text='Synthetic; $(private)', language='ca')) == b'synthetic mp3'
    assert len(paths) == 1 and not paths[0].parent.exists()


def test_native_process_cancel_kills_and_reaps(configured, monkeypatch):
    events = []
    class Process:
        returncode = None
        async def communicate(self, text):
            events.append(text)
            raise asyncio.CancelledError()
        def kill(self):
            events.append('kill')
        async def wait(self):
            events.append('wait')
            self.returncode = -9
    async def create(*args, **kwargs):
        assert args[0] == '/usr/bin/say' and kwargs['stdin'] == asyncio.subprocess.PIPE
        return Process()
    monkeypatch.setattr(speech.sys, 'platform', 'darwin')
    monkeypatch.setattr(speech.Path, 'is_file', lambda path: True)
    monkeypatch.setattr(speech.asyncio, 'create_subprocess_exec', create)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(speech._say(['-v', 'Installed'], b'Synthetic'))
    assert events == [b'Synthetic', 'kill', 'wait']


def test_cache_changes_with_every_effective_setting(configured):
    initial = speech.fingerprint('Synthetic', 'ca')
    for setting in [dict(provider='openai'), dict(speed=1.1), dict(voice='Installed'), dict(language='fr')]:
        configured.ai['speech_output'] = setting
        assert speech.fingerprint('Synthetic', 'ca') != initial
    configured.ai.pop('speech_output')
    assert speech.fingerprint('Synthetic', 'fr') != initial


def test_document_and_live_use_same_settings_and_chunker(configured, monkeypatch, tmp_path):
    calls = []
    async def synthesize(**kwargs):
        calls.append(kwargs)
        return b'mp3'
    monkeypatch.setattr(speech, 'synthesize_speech', synthesize)
    output = tmp_path / 'audio.mp3'
    monkeypatch.setattr(speech, '_write_document_mp3', lambda chunks, path, cancelled=None: Path(path).write_bytes(b''.join(chunks)))
    speech.generate_document('One sentence. ' + 'word ' * 1000, output, 'ca')
    assert len(calls) > 1 and all(len(call['text']) <= speech.MAX_TEXT_CHARS for call in calls)
    assert all(call['settings'] == speech.effective_settings_sync('ca') and call['language'] == 'ca' for call in calls)
    assert output.read_bytes() == b'mp3' * len(calls)


def test_roles_and_scope_contract(tmp_path, configured):
    for path, role in [('/speech/settings', 'admin'), ('/workspace/voice/speak', 'editor')]:
        entry = next(item for item in route.router.routes if item.path == path and ('PUT' in item.methods if role == 'admin' else 'POST' in item.methods))
        dependency = next(item for item in entry.dependant.dependencies if item.name == 'context')
        with pytest.raises(HTTPException) as error:
            dependency.call(WorkspaceContext('workspace', 'user', 'viewer', Path('/synthetic/vault')))
        assert error.value.status_code == 403
    with pytest.raises(HTTPException):
        asyncio.run(route.synthesize_workspace_speech(payload(agent_id='../outside'), Connected(), context(tmp_path)))


def test_disconnect_cancels_inflight_synthesis(tmp_path, configured, monkeypatch):
    cancelled = []
    started = asyncio.Event()
    async def synthesize(**kwargs):
        started.set()
        try:
            await asyncio.Future()
        finally:
            cancelled.append(True)
    class Disconnected:
        async def is_disconnected(self):
            await started.wait()
            return True
    monkeypatch.setattr(speech, 'synthesize_speech', synthesize)
    with pytest.raises(HTTPException) as error:
        asyncio.run(route.synthesize_workspace_speech(payload(), Disconnected(), context(tmp_path)))
    assert error.value.status_code == 499 and cancelled == [True]



def test_settings_save_uses_existing_atomic_config_endpoint(configured, monkeypatch, tmp_path):
    from backend.domains.configuration.api import settings as configuration
    saved = []
    async def update(payload, request):
        saved.append(payload.root)
        configured.ai['speech_output'] = payload.root['ai']['speech_output']
        return {'status': 'success'}
    async def voices():
        return []
    monkeypatch.setattr(configuration, 'update_config', update)
    monkeypatch.setattr(speech, 'local_voices', voices)
    selection = speech.SpeechSettings(provider='openai', voice='cedar', speed=1.1)
    result = asyncio.run(route.put_speech_settings(selection, Connected(), context(tmp_path)))
    assert saved == [{'ai': {'speech_output': selection.model_dump()}}]
    assert result.settings == selection
    assert result.revision == speech.revision(speech.effective_settings_sync(settings=selection))


def test_preview_uses_saved_engine_and_fixed_localized_sample(configured, monkeypatch, tmp_path):
    configured.ai['speech_output'] = dict(language='fr')
    calls = []
    async def synthesize(**kwargs):
        calls.append(kwargs)
        return b'preview mp3'
    monkeypatch.setattr(speech, 'synthesize_speech', synthesize)
    result = asyncio.run(route.preview_speech(route.SpeechPreviewRequest(language='en'), Connected(), context(tmp_path)))
    assert result.body == b'preview mp3'
    assert calls[0]['text'] == route.SAMPLES['fr']
    assert calls[0]['settings'] == speech.effective_settings_sync('en')


def test_spoken_prose_cleanup_is_shared():
    value = "# Title\n[Read this](https://private.invalid/path) [1]\n```python\nsecret = 1\n```\n**Useful** &amp; clear"
    result = speech.spoken_text(value)
    assert result == "Title\nRead this \nUseful & clear"
    assert speech.spoken_text(result) == result


def test_duplicate_native_voice_selectors_remain_available(configured, monkeypatch):
    async def say(args, text=None, timeout=15):
        assert args == ['-v', '?']
        return ('Montse (Català (Espanya)) ca_ES # Synthetic\n' * 2).encode()
    monkeypatch.setattr(speech.sys, 'platform', 'darwin')
    monkeypatch.setattr(speech.Path, 'is_file', lambda path: True)
    monkeypatch.setattr(speech, '_say', say)
    voices = asyncio.run(_REAL_LOCAL_VOICES())
    assert voices == [speech.SpeechVoice(id='Montse (Català (Espanya))', language='ca-ES')]


def test_effective_auto_voice_changes_cache_and_freezes_document_session(configured, monkeypatch, tmp_path):
    available = [speech.SpeechVoice(id='Original Voice', language='ca-ES')]
    async def voices():
        return available.copy()
    monkeypatch.setattr(speech, 'local_voices', voices)
    first = speech.effective_settings_sync('ca')
    first_id = speech.fingerprint('Synthetic', 'ca', first)
    available.insert(0, speech.SpeechVoice(id='Preferred Voice (Enhanced)', language='ca-ES'))
    second = speech.effective_settings_sync('ca')
    assert first.voice == 'Original Voice' and second.voice == 'Preferred Voice (Enhanced)'
    assert speech.fingerprint('Synthetic', 'ca', second) != first_id
    calls = []
    async def synthesize(**kwargs):
        calls.append(kwargs['settings'])
        return b'mp3'
    monkeypatch.setattr(speech, 'synthesize_speech', synthesize)
    monkeypatch.setattr(speech, '_write_document_mp3', lambda chunks, path, cancelled=None: Path(path).write_bytes(b''.join(chunks)))
    with speech.speech_session(first):
        assert speech.fingerprint('Synthetic', 'ca') == first_id
        speech.generate_document('Synthetic', tmp_path / 'speech.mp3', 'ca')
    assert calls == [first]


def _fake_live_encoder(monkeypatch):
    """Exercise the real cooperative loop using synthetic codec objects."""
    import sys
    closed = []
    decoded = []
    class Frame:
        pass
    class Source:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            closed.append('source')
        def decode(self, **kwargs):
            for index in range(10000):
                decoded.append(index)
                yield Frame()
    class Stream:
        codec_context = SimpleNamespace(format=None)
        layout = None
        def encode(self, frame):
            return [object()] if frame is not None else []
    class Destination:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            closed.append('destination')
        def add_stream(self, *args, **kwargs):
            return Stream()
        def mux(self, packet):
            pass
    class Resampler:
        def __init__(self, **kwargs):
            pass
        def resample(self, frame):
            return [frame] if frame is not None else []
    def open_audio(*args, **kwargs):
        return Destination() if kwargs.get('mode') == 'w' else Source()
    monkeypatch.setitem(sys.modules, 'av', SimpleNamespace(open=open_audio, AudioFrame=Frame, AudioResampler=Resampler))
    return closed, decoded


def test_live_encoder_cancel_closes_containers_before_return(monkeypatch):
    import threading
    import time
    closed, decoded = _fake_live_encoder(monkeypatch)
    async def exercise():
        task = asyncio.create_task(speech._encode_mp3(b'synthetic', threading.Event(), time.monotonic() + 10))
        await asyncio.sleep(0)
        assert decoded == [0]
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert closed == ['destination', 'source']
        assert decoded == [0]
    asyncio.run(exercise())
    assert speech._ENCODER_SLOT.acquire(blocking=False)
    speech._ENCODER_SLOT.release()


def test_live_encoder_deadline_stops_before_next_frame(monkeypatch):
    import threading
    closed, decoded = _fake_live_encoder(monkeypatch)
    monkeypatch.setattr(speech.time, 'monotonic', lambda: 10.0)
    with pytest.raises(speech.SpeechProviderFailure):
        asyncio.run(speech._encode_mp3(b'synthetic', threading.Event(), 9.0))
    assert closed == ['destination', 'source'] and decoded == [0]
    assert speech._ENCODER_SLOT.acquire(blocking=False)
    speech._ENCODER_SLOT.release()


def test_encoder_global_bound_covers_other_loops_and_document_writer(monkeypatch, tmp_path):
    import threading
    import time
    _fake_live_encoder(monkeypatch)
    assert speech._ENCODER_SLOT.acquire(blocking=False)
    failures = []
    def other_loop():
        try:
            asyncio.run(speech._encode_mp3(b'synthetic', threading.Event(), time.monotonic() + 10))
        except speech.SpeechProviderFailure:
            failures.append('busy')
    try:
        worker = threading.Thread(target=other_loop)
        worker.start()
        worker.join(timeout=1)
        assert not worker.is_alive() and failures == ['busy']
        with pytest.raises(speech.SpeechProviderFailure):
            speech._write_document_mp3([], tmp_path / 'unused.mp3')
        assert not (tmp_path / 'unused.mp3').exists()
    finally:
        speech._ENCODER_SLOT.release()
