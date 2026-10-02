"""Reject incomplete/empty handwritten inputs before loading any model."""
import asyncio
import io
from unittest.mock import Mock

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageDraw

from backend.api import handwriting_routes
from backend.services import handwriting


def png(image):
    data = io.BytesIO()
    image.save(data, format='PNG')
    return data.getvalue()


def lines_image(count):
    image = Image.new('RGB', (120, count * 15 + 20), 'white')
    draw = ImageDraw.Draw(image)
    for index in range(count):
        draw.rectangle((10, 10 + index * 15, 100, 16 + index * 15), fill='black')
    return image


@pytest.mark.parametrize('mode,color', [('RGB', 'white'), ('RGBA', (0, 0, 0, 0))])
def test_blank_and_transparent_canvases_do_not_load_or_invoke_a_model(monkeypatch, mode, color):
    load = Mock()
    monkeypatch.setattr(handwriting, '_load', load)
    with pytest.raises(handwriting.HandwritingInputError, match='blank_image'):
        handwriting._recognize_engine(png(Image.new(mode, (200, 100), color)), correct=False)
    load.assert_not_called()


def test_invalid_image_fails_before_loading_a_model(monkeypatch):
    load = Mock()
    monkeypatch.setattr(handwriting, '_load', load)
    with pytest.raises(handwriting.HandwritingInputError, match='invalid_image'):
        handwriting._recognize_engine(b'not an image', correct=False)
    load.assert_not_called()


def test_more_than_40_lines_are_rejected_instead_of_silently_cropped(monkeypatch):
    assert len(handwriting._segment_lines(lines_image(40))) == 40
    load = Mock()
    monkeypatch.setattr(handwriting, '_load', load)
    with pytest.raises(handwriting.HandwritingInputError, match='too_many_lines'):
        handwriting._recognize_engine(png(lines_image(41)), correct=False)
    load.assert_not_called()


@pytest.mark.parametrize('language,fragment', [('ca', 'no conté traços'), ('es', 'no contiene trazos'),
    ('en', 'contains no strokes'), ('fr', 'aucun trait')])
def test_input_errors_are_422_and_localized(monkeypatch, language, fragment):
    monkeypatch.setattr(handwriting, 'is_available', lambda: True)
    def reject(*args):
        raise handwriting.HandwritingInputError('blank_image')
    monkeypatch.setattr(handwriting, 'recognize', reject)
    upload = UploadFile(filename='blank.png', file=io.BytesIO(b'fixture'))
    with pytest.raises(HTTPException) as result:
        asyncio.run(handwriting_routes.recognize_handwriting(upload, correct=False, language=language))
    assert result.value.status_code == 422
    assert fragment in result.value.detail


@pytest.mark.parametrize('ends_with_eos', [False, True])
def test_generated_line_at_token_ceiling_requires_eos(monkeypatch, ends_with_eos):
    import sys
    from contextlib import nullcontext
    from types import SimpleNamespace
    class Tokens(list):
        def tolist(self):
            return list(self)
    tokens = Tokens([1] * 65)
    if ends_with_eos:
        tokens[-1] = 2
    processor = Mock(return_value=SimpleNamespace(pixel_values='pixels'))
    processor.batch_decode.return_value = ['complete line']
    model = SimpleNamespace(generation_config=SimpleNamespace(eos_token_id=2), generate=Mock(return_value=[tokens]))
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(no_grad=nullcontext))
    monkeypatch.setattr(handwriting, '_load', lambda: (processor, model, 'loaded-model'))
    monkeypatch.setattr(handwriting, '_model_id', lambda: 'changed-config-model')
    if ends_with_eos:
        result = handwriting._recognize_engine(png(lines_image(1)), correct=False)
        assert result['raw'] == 'complete line'
        assert result['model'] == 'loaded-model'
    else:
        with pytest.raises(handwriting.HandwritingInputError, match='line_too_long'):
            handwriting._recognize_engine(png(lines_image(1)), correct=False)
        processor.batch_decode.assert_not_called()


def test_model_cache_tracks_model_and_directory_and_preserves_old_pair_on_failure(monkeypatch, tmp_path):
    from backend.services import handwriting_download
    import sys
    from types import SimpleNamespace
    selected = {'model': 'first-model', 'cache': str(tmp_path / 'first-cache')}
    monkeypatch.setattr(handwriting, '_MODEL', None)
    monkeypatch.setattr(handwriting, '_PROCESSOR', None)
    monkeypatch.setattr(handwriting, '_MODEL_KEY', None)
    monkeypatch.setattr(handwriting, '_model_id', lambda: selected['model'])
    monkeypatch.setattr(handwriting, '_cache_dir', lambda: selected['cache'])
    monkeypatch.setattr(handwriting_download, 'prepare', lambda model, cache, owner: model)
    processor_loader = Mock(side_effect=[object(), object(), object(), object()])
    models = [SimpleNamespace(eval=Mock()) for _ in range(3)]
    model_loader = Mock(side_effect=[*models, OSError('weights unavailable')])
    monkeypatch.setitem(sys.modules, 'transformers', SimpleNamespace(
        TrOCRProcessor=SimpleNamespace(from_pretrained=processor_loader),
        VisionEncoderDecoderModel=SimpleNamespace(from_pretrained=model_loader)))
    first = handwriting._load()
    assert handwriting.is_loaded() and handwriting._load() == first
    assert model_loader.call_count == 1
    selected['model'] = 'second-model'
    assert not handwriting.is_loaded()
    second = handwriting._load()
    assert second[1] is models[1] and second[2] == 'second-model'
    selected['cache'] = str(tmp_path / 'second-cache')
    third = handwriting._load()
    assert third[1] is models[2]
    assert model_loader.call_args.kwargs['cache_dir'] == selected['cache']
    selected['model'] = 'missing-model'
    with pytest.raises(OSError, match='weights unavailable'):
        handwriting._load()
    assert not handwriting.is_loaded()
    assert handwriting._MODEL is third[1] and handwriting._PROCESSOR is third[0]


@pytest.mark.parametrize('configured,argument,should_correct', [
    (None, None, False), (False, None, False), (True, None, True),
    ('true', None, False), (1, None, False), (True, False, False), (None, True, True),
])
def test_recognition_never_corrects_without_explicit_activation(monkeypatch, configured, argument, should_correct):
    from backend.services import agent_specialized_tools
    monkeypatch.setattr(handwriting, 'load_params', lambda **kwargs: {'ai': {'handwriting': {'correct': configured}}})
    raw = 'Original text'
    result = {'text': raw, 'raw': raw, 'lines': [raw], 'model': 'local', 'corrected': False}
    monkeypatch.setattr(agent_specialized_tools, 'run_engine', lambda *args: dict(result))
    correction = Mock(return_value='Corrected text')
    monkeypatch.setattr(handwriting, '_correct_text', correction)
    recognized = handwriting.recognize(b'fixture', correct=argument)
    assert correction.call_count == int(should_correct)
    assert recognized['raw'] == raw
    assert recognized['text'] == ('Corrected text' if should_correct else raw)
    assert recognized['corrected'] is should_correct


@pytest.mark.parametrize('corrected', ['12 participants and a budget of 250 euros.', 'A budget of 240 euros.', '12 participants and 240 euros.'])
def test_ocr_correction_cannot_change_or_drop_numeric_values(monkeypatch, corrected):
    from backend.services import agent_execution
    monkeypatch.setattr(agent_execution, 'generate_for', lambda *args, **kwargs: (corrected, 'fixture'))
    result = handwriting._correct_text('12 participanrs and a budget of 240 euros.', 'en')
    assert result == (corrected if corrected == '12 participants and 240 euros.' else None)


def test_warmup_is_nonblocking_while_weights_load_and_copies_selected_context(monkeypatch, tmp_path):
    import threading
    import time
    from contextvars import ContextVar
    selected = ContextVar('test_selected_ocr_model', default='wrong-default-context')
    entered = threading.Event()
    release = threading.Event()
    seen = []
    threads = {}
    monkeypatch.setattr(handwriting, '_WARMUP_THREADS', threads)
    monkeypatch.setattr(handwriting, 'is_available', lambda: True)
    monkeypatch.setattr(handwriting, 'is_loaded', lambda: False)
    monkeypatch.setattr(handwriting, '_model_id', selected.get)
    monkeypatch.setattr(handwriting, '_cache_dir', lambda: str(tmp_path))
    def load():
        seen.append(selected.get())
        with handwriting._LOCK:
            entered.set()
            release.wait(3)
    monkeypatch.setattr(handwriting, '_load', load)
    token = selected.set('selected-vault-model')
    try:
        assert handwriting.warmup()
        assert entered.wait(1)
        started = time.monotonic()
        assert handwriting.warmup()
        assert time.monotonic() - started < 0.5
        assert len(threads) == 1
        assert seen == ['selected-vault-model']
    finally:
        release.set()
        for thread in threads.values():
            thread.join(timeout=1)
        selected.reset(token)


def test_status_dependency_probe_does_not_block_the_async_event_loop(monkeypatch):
    import threading
    entered = threading.Event()
    release = threading.Event()
    def available():
        entered.set()
        release.wait(2)
        return True
    monkeypatch.setattr(handwriting, 'is_available', available)
    monkeypatch.setattr(handwriting, 'is_loaded', lambda: False)
    monkeypatch.setattr(handwriting, '_model_id', lambda: 'local-model')
    async def exercise():
        task = asyncio.create_task(handwriting_routes.handwriting_status())
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            assert not task.done()
        finally:
            release.set()
        result = await task
        assert result['available'] is True and result['loaded'] is False and result['model'] == 'local-model'
        assert result['state'] == 'not_downloaded' and result['downloaded'] is False
    asyncio.run(exercise())
