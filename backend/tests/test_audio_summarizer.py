from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.agent import factory
from backend.services import audio_summarizer


class FakeLlm:
    def __init__(self, response=None):
        self.response = response or SimpleNamespace(content="Generated script")
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        return self.response


def _config(settings=None, models=None, providers=None):
    return SimpleNamespace(
        settings=settings or {},
        ai={"models": models or [], "providers": providers or {}},
    )


def test_podcast_model_selection_requires_provider_and_model_together():
    with pytest.raises(audio_summarizer.PodcastModelError, match="incomplete"):
        audio_summarizer._podcast_model_selection(
            {"reader": {"podcast": {"provider": "groq"}}}
        )


@pytest.mark.parametrize(
    ("settings", "expected"),
    [
        ({"language": "ca"}, ("ca", "Catalan")),
        ({"language": "es"}, ("es", "Spanish")),
        ({"language": "fr"}, ("fr", "French")),
        ({"language": "en"}, ("en", "English")),
        ({"language": "unsupported"}, ("en", "English")),
        ({}, ("en", "English")),
    ],
)
def test_podcast_language_selection_follows_normalized_interface_language(
    settings, expected
):
    assert audio_summarizer._podcast_language_selection(settings) == expected


def test_resolve_podcast_language_reads_current_settings_each_time(monkeypatch):
    configs = iter([
        _config(settings={"language": "ca"}),
        _config(settings={"language": "fr"}),
    ])
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: next(configs),
    )

    assert audio_summarizer._resolve_podcast_language() == ("ca", "Catalan")
    assert audio_summarizer._resolve_podcast_language() == ("fr", "French")

@pytest.mark.parametrize("old_route", [{}, {"provider": "old", "model": "disabled"}])
def test_podcast_uses_only_the_principal_snapshot(monkeypatch, old_route):
    from backend.services import agent_execution
    snapshot = SimpleNamespace(profile={"provider": "principal-provider", "model": "principal-model"})
    requested = []
    def prepare(skill):
        requested.append(skill)
        return snapshot
    monkeypatch.setattr(agent_execution, "prepare_snapshot", prepare)
    monkeypatch.setattr("backend.config.app_config.load_params", lambda **_: _config(settings={"reader": {"podcast": old_route}}))
    assert audio_summarizer._resolve_podcast_llm() == (snapshot, "principal-provider", "principal-model")
    assert requested == ["core.gnosi-daily-briefing"]


def test_podcast_reports_missing_principal_without_legacy_fallback(monkeypatch):
    from backend.services import agent_execution
    def unavailable(_):
        raise RuntimeError("principal_agent_unavailable")
    monkeypatch.setattr(agent_execution, "prepare_snapshot", unavailable)
    with pytest.raises(RuntimeError, match="principal_agent_unavailable"):
        audio_summarizer._resolve_podcast_llm()


def test_summarize_batch_uses_shared_executor_and_preserves_language(monkeypatch):
    from backend.services import agent_execution
    snapshot = SimpleNamespace(profile={})
    calls = []
    def execute(request, **kwargs):
        calls.append((request, kwargs))
        return SimpleNamespace(result="Podcast script")
    monkeypatch.setattr(agent_execution, "run_sync", execute)
    assert audio_summarizer._summarize_batch(snapshot, ["News evidence"], 1, 1, "ignored", "ignored", "Catalan") == "Podcast script"
    request, kwargs = calls[0]
    assert kwargs["snapshot"] is snapshot
    assert request.skill_id == "core.gnosi-daily-briefing"
    assert request.language == "Catalan"
    assert "News evidence" in request.input
    import json
    assert json.loads(request.input)["data"]["language"] == "Catalan"


def test_generate_tts_uses_selected_language(monkeypatch, tmp_path):
    from backend.services import workspace_speech
    observed = []
    def generate(text, output_path, language):
        observed.append((text, language))
        output_path.write_bytes(b"audio")
    monkeypatch.setattr(workspace_speech, "generate_document", generate)
    output_path = tmp_path / "podcast.mp3"
    audio_summarizer._generate_tts_by_sentences("First. Second.", output_path, "ca")
    assert observed == [("First. Second.", "ca")]
    assert output_path.read_bytes() == b"audio"


def test_generate_tts_publishes_audio_atomically(monkeypatch, tmp_path):
    output_path = tmp_path / "podcast.mp3"
    output_path.write_bytes(b"previous")

    def fake_generate(text, partial_path, language_code):
        assert partial_path == f"{output_path}.part"
        assert output_path.read_bytes() == b"previous"
        Path(partial_path).write_bytes(b"complete")

    monkeypatch.setattr(audio_summarizer, "_generate_tts_by_sentences", fake_generate)

    audio_summarizer._generate_tts_atomically("Guió", output_path, "ca")

    assert output_path.read_bytes() == b"complete"
    assert not Path(f"{output_path}.part").exists()


def test_generate_tts_keeps_previous_audio_when_generation_fails(
    monkeypatch, tmp_path
):
    output_path = tmp_path / "podcast.mp3"
    output_path.write_bytes(b"previous")

    def fake_generate(text, partial_path, language_code):
        Path(partial_path).write_bytes(b"incomplete")
        raise RuntimeError("network failure")

    monkeypatch.setattr(audio_summarizer, "_generate_tts_by_sentences", fake_generate)

    with pytest.raises(RuntimeError, match="network failure"):
        audio_summarizer._generate_tts_atomically("Guió", output_path, "ca")

    assert output_path.read_bytes() == b"previous"
    assert not Path(f"{output_path}.part").exists()


def test_podcast_output_dir_is_inside_selected_vault(tmp_path):
    assert audio_summarizer.get_podcast_output_dir(tmp_path) == (
        Path(tmp_path) / "data" / "podcasts"
    )


def test_async_generation_preserves_selected_vault(monkeypatch, tmp_path):
    observed_paths = []

    def fake_generate(snapshot=None):
        from backend.services.context_vars import get_active_vault_path

        observed_paths.append(get_active_vault_path())
        audio_summarizer._generation_state()["running"] = False

    class ImmediateThread:
        def __init__(self, target, daemon, args=()):
            self.target = lambda: target(*args)

        def start(self):
            self.target()

    monkeypatch.setattr(audio_summarizer, "generate_daily_podcast", fake_generate)
    monkeypatch.setattr(audio_summarizer.threading, "Thread", ImmediateThread)

    from backend.services.agent_execution_models import ExecutionScope
    from backend.services.agent_execution_scope import execution_scope
    monkeypatch.setattr("backend.services.agent_execution_scope.revalidate_scope", lambda _: None)
    scope = ExecutionScope(user_id="alice", workspace_id="team", role="owner", vault_path=str(tmp_path))
    from backend.services.agent_execution_models import AgentExecutionSnapshot
    from backend.services import agent_execution_store as store
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id='personal', profile={'id': 'personal'}, skill_ids=[], instructions=[], catalog_revision='1', revision='1')
    monkeypatch.setattr(audio_summarizer, '_resolve_podcast_llm', lambda: (snapshot, 'fixture', 'fixture'))
    monkeypatch.setattr(store, 'resolve_data_dir', lambda **_: tmp_path)
    with execution_scope(scope):
        audio_summarizer._generation_state()["running"] = False
        assert audio_summarizer.start_generation_async(vault_path=tmp_path) is True
    assert observed_paths == [Path(tmp_path)]


def test_podcast_normalizes_bodies_before_deciding_to_skip():
    def article(identifier, full, summary):
        return SimpleNamespace(id=identifier, title=f'Article {identifier}',
                               full_content=full, content=summary, source=None)
    readable, skipped = audio_summarizer._readable_podcast_articles([
        article(109, '<p> </p>', None),
        article(110, '<p> </p>', '<p>Feed evidence</p>'),
        article(111, '<p>Full evidence</p>', 'Summary'),
    ])
    assert [(a.id, a.content) for a in readable] == [(110, 'Feed evidence'), (111, 'Full evidence')]
    assert skipped == [{'id': '109', 'title': 'Article 109'}]


@pytest.mark.parametrize('resources', [{}, {'fixture': True}])
@pytest.mark.parametrize('resuming', [False, True])
@pytest.mark.parametrize('all_empty', [False, True])
@pytest.mark.parametrize('body, expected', [('Actual news evidence.', 'Actual news evidence.'), ('<p>&lt;br&gt;</p>', '<br>')])
def test_podcast_omissions_do_not_abort_readable_sources(monkeypatch, tmp_path, resources, resuming, all_empty, body, expected):
    from contextlib import nullcontext
    from unittest.mock import Mock
    from backend.services import podcast_briefing, agent_execution_store, workspace_speech

    articles = [SimpleNamespace(id=109, title='Missing', full_content='<p> </p>', content='', source=None)]
    if not all_empty:
        articles.append(SimpleNamespace(id=110, title='Readable', full_content='', content=body, source=None))
    state = dict(running=False, progress='', error=None, result_filename=None, skipped_articles=[])
    snapshot = SimpleNamespace(scope='test', parent_run_id='job', behavior_resources=resources)
    saved = {}
    if resuming:
        saved['podcast-input'] = dict(articles=[dict(id=a.id, title=a.title, full_content=a.full_content,
            content=a.content, source='') for a in articles], language_code='ca', language_name='Catalan', audio_filename='frozen.mp3')
    def checkpoint(scope, run, key, value=None):
        if value is not None:
            saved[key] = value
        return saved.get(key)
    db = Mock()
    db.query.return_value.filter.return_value.all.return_value = articles
    def database():
        yield db
    monkeypatch.setattr('backend.data.db.get_db', database)
    monkeypatch.setattr(audio_summarizer, '_generation_state', lambda: state)
    monkeypatch.setattr(audio_summarizer, '_resolve_podcast_llm', lambda: (snapshot, 'test', 'test'))
    monkeypatch.setattr(audio_summarizer, '_resolve_podcast_language', lambda: ('ca', 'Catalan'))
    monkeypatch.setattr(agent_execution_store, 'work_checkpoint', checkpoint)
    calls = []
    def build_script(sources, language, **kwargs):
        assert sources == [{'id': '110', 'title': 'Readable', 'text': expected}]
        assert language == 'Catalan'
        assert kwargs['snapshot'] is snapshot
        assert callable(kwargs['check_active']) and callable(kwargs['progress'])
        calls.append(sources)
        return 'Verified script'
    monkeypatch.setattr(podcast_briefing, 'build_podcast_script', build_script)
    monkeypatch.setattr(audio_summarizer, 'get_podcast_output_dir', lambda: tmp_path)
    monkeypatch.setattr('backend.services.agent_specialized_tools.run_engine', lambda kind, name, action: action())
    monkeypatch.setattr(workspace_speech, 'effective_settings_sync', lambda language: {})
    monkeypatch.setattr(workspace_speech, 'speech_session', lambda settings: nullcontext())
    monkeypatch.setattr(workspace_speech, 'fingerprint', lambda text, language: 'fixture')
    def generate(text, path, language):
        assert text == 'Verified script'
        path.write_bytes(b'complete audio')
    monkeypatch.setattr(audio_summarizer, '_generate_tts_atomically', generate)
    monkeypatch.setattr(audio_summarizer, '_publish_podcast_audio', lambda llm, staged, target: staged.replace(target))
    previous = tmp_path / 'previous.mp3'
    previous.write_bytes(b'previous audio')
    result = audio_summarizer._generate_daily_podcast()
    assert state['skipped_articles'] == [{'id': '109', 'title': 'Missing'}]
    assert saved['podcast-skipped']['articles'] == state['skipped_articles']
    assert not state['running']
    assert previous.read_bytes() == b'previous audio'
    if all_empty:
        assert result is None
        assert state['error'] == 'podcast_no_readable_articles'
        assert calls == []
        assert list(tmp_path.iterdir()) == [previous]
    else:
        assert state['error'] is None
        assert (tmp_path / result).read_bytes() == b'complete audio'
        if resuming:
            assert result == 'frozen.mp3'


def test_daily_selection_includes_read_articles_and_freezes_legacy_resume(monkeypatch):
    import copy
    from datetime import datetime, timedelta, timezone
    from unittest.mock import Mock
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from backend.models.reader import Article, FeedSource
    from backend.services import agent_execution_store, podcast_briefing

    engine = create_engine('sqlite://')
    FeedSource.__table__.create(engine)
    Article.__table__.create(engine)
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        session.add_all([
            Article(id=1, title='Unread climate', full_content='Climate evidence', is_read=False, published_at=now-timedelta(hours=1)),
            Article(id=2, title='Read housing', full_content='Housing evidence', is_read=True, published_at=now-timedelta(hours=2)),
            Article(id=3, title='Too old', full_content='Older evidence', published_at=now-timedelta(days=2)),
            Article(id=4, title='Future', full_content='Future evidence', published_at=now+timedelta(days=1)),
        ])
        session.commit()
        db = Mock(wraps=session)
        def database():
            yield db
        saved, observed = {}, []
        def checkpoint(scope, parent, key, value=None):
            if value is not None:
                saved[key] = copy.deepcopy(value)
            return copy.deepcopy(saved.get(key))
        def interrupted(sources, language, **kwargs):
            observed.append((sources, language))
            raise RuntimeError('interrupted before speech')
        state = dict(running=False, progress='', error=None, result_filename=None, skipped_articles=[])
        snapshot = SimpleNamespace(scope='owner', parent_run_id='legacy-day', behavior_resources={})
        monkeypatch.setattr('backend.data.db.get_db', database)
        monkeypatch.setattr(agent_execution_store, 'work_checkpoint', checkpoint)
        monkeypatch.setattr(podcast_briefing, 'build_podcast_script', interrupted)
        monkeypatch.setattr(audio_summarizer, '_generation_state', lambda: state)
        monkeypatch.setattr(audio_summarizer, '_resolve_podcast_llm', lambda: (snapshot, 'fake', 'fake'))
        languages = iter([('ca', 'Catalan'), ('fr', 'French')])
        monkeypatch.setattr(audio_summarizer, '_resolve_podcast_language', lambda: next(languages))
        assert audio_summarizer._generate_daily_podcast() is None
        assert {a['id'] for a in observed[0][0]} == {'1', '2'}
        session.query(Article).filter(Article.id == 1).update({'published_at': now-timedelta(days=3)})
        session.add(Article(id=5, title='Arrived later', full_content='Later evidence', published_at=now))
        session.commit()
        assert audio_summarizer._generate_daily_podcast() is None
        assert observed[1] == observed[0]
        assert observed[1][1] == 'Catalan'
        assert db.query.call_count == 1
        assert saved['podcast-input']['period_start'] < saved['podcast-input']['period_end']
    engine.dispose()
