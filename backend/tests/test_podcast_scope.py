"""Private podcast status and selected-vault worker boundaries."""
from pathlib import Path
from unittest.mock import Mock

import pytest

from backend.services import audio_summarizer as audio
from backend.services import agent_execution as execution, agent_execution_store as store
from backend.services.agent_execution_models import AgentExecutionSnapshot, ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.domains.reader import podcast_routes


@pytest.fixture
def owner(monkeypatch, tmp_path):
    scope = ExecutionScope(user_id='alice', workspace_id='team', role='owner', vault_path=str(tmp_path / 'vault'))
    monkeypatch.setattr(audio, '_generation_states', {})
    monkeypatch.setattr('backend.services.agent_execution_scope.revalidate_scope', lambda _: None)
    monkeypatch.setattr(store, 'resolve_data_dir', lambda **_: tmp_path)
    snapshot = AgentExecutionSnapshot(scope=scope, agent_id='personal', profile={'id': 'personal'}, skill_ids=[], instructions=[], catalog_revision='1', revision='1')
    monkeypatch.setattr(audio, '_resolve_podcast_llm', lambda: (snapshot, 'fixture', 'fixture'))
    return scope


@pytest.mark.parametrize('changes', [{'user_id': 'bob'}, {'workspace_id': 'other'}, {'vault_path': '/private/tmp/other-fixture'}])
def test_status_does_not_expose_other_user_workspace_or_vault(owner, changes):
    with execution_scope(owner):
        audio._generation_state().update(running=True, progress='Private article title', error='Private failure', result_filename='private-episode.mp3')
        assert podcast_routes.get_podcast_status()['progress'] == 'Private article title'
    with execution_scope(owner.model_copy(update=changes)):
        assert podcast_routes.get_podcast_status() == {'running': False, 'progress': '', 'error': None, 'result_filename': None}
    with execution_scope(owner):
        copy = audio.get_generation_status()
        copy['progress'] = 'tampered'
        assert audio.get_generation_status()['progress'] == 'Private article title'


def test_start_rejects_a_different_vault_before_spawning_any_worker(owner, monkeypatch, tmp_path):
    thread = Mock()
    monkeypatch.setattr(audio.threading, 'Thread', thread)
    with execution_scope(owner), pytest.raises(PermissionError, match='vault_scope_mismatch'):
        audio.start_generation_async(tmp_path / 'different-vault')
    thread.assert_not_called()


def test_viewer_cannot_start_or_resume_generation(owner, monkeypatch):
    thread = Mock()
    monkeypatch.setattr(audio.threading, 'Thread', thread)
    snapshot = AgentExecutionSnapshot(scope=owner, agent_id='personal', profile={'id': 'personal'}, skill_ids=[], instructions=[], catalog_revision='1', revision='1')
    with execution_scope(owner.model_copy(update={'role': 'viewer'})):
        with pytest.raises(PermissionError, match='editor_required'):
            audio.start_generation_async()
        with pytest.raises(PermissionError, match='editor_required'):
            audio.resume_podcast(snapshot)
    thread.assert_not_called()


def test_another_owner_cannot_resume_the_private_snapshot(owner, monkeypatch):
    thread = Mock()
    monkeypatch.setattr(audio.threading, 'Thread', thread)
    snapshot = AgentExecutionSnapshot(scope=owner, agent_id='personal', profile={'id': 'personal'}, skill_ids=[], instructions=[], catalog_revision='1', revision='1')
    with execution_scope(owner.model_copy(update={'user_id': 'bob'})), pytest.raises(PermissionError, match='resume_scope_mismatch'):
        audio.resume_podcast(snapshot)
    thread.assert_not_called()


def test_shared_vault_publication_is_reserved_without_disclosing_another_owners_progress(owner, monkeypatch):
    thread = Mock()
    monkeypatch.setattr(audio.threading, 'Thread', thread)
    with execution_scope(owner):
        audio._generation_state().update(running=True, progress='Private title')
    with execution_scope(owner.model_copy(update={'user_id': 'bob'})):
        assert audio.get_generation_status()['progress'] == ''
        assert audio.start_generation_async() is False
    thread.assert_not_called()


def test_failed_thread_start_releases_private_reservation(owner, monkeypatch):
    thread = Mock()
    thread.return_value.start.side_effect = RuntimeError('thread failed')
    monkeypatch.setattr(audio.threading, 'Thread', thread)
    with execution_scope(owner):
        with pytest.raises(RuntimeError, match='thread failed'):
            audio.start_generation_async()
        assert audio.get_generation_status()['running'] is False
        thread.return_value.start.side_effect = None
        assert audio.start_generation_async()


def test_background_ack_has_durable_job_before_worker_starts(owner, monkeypatch):
    thread = Mock()
    monkeypatch.setattr(audio.threading, 'Thread', thread)
    with execution_scope(owner):
        assert audio.start_generation_async()
        job = store.latest_job(owner, 'podcast')
        assert job is not None and job.status == 'queued'
        audio._generation_states.clear()
        assert audio.get_generation_status()['running'] is True


def test_persistent_reservation_survives_memory_reset_and_blocks_other_owner(owner, monkeypatch):
    monkeypatch.setattr(audio.threading, 'Thread', Mock())
    with execution_scope(owner):
        assert audio.start_generation_async()
        audio._generation_states.clear()
    other = owner.model_copy(update={'user_id': 'bob'})
    snapshot = AgentExecutionSnapshot(scope=other, agent_id='personal', profile={'id': 'personal'}, skill_ids=[], instructions=[], catalog_revision='1', revision='1')
    monkeypatch.setattr(audio, '_resolve_podcast_llm', lambda: (snapshot, 'fixture', 'fixture'))
    with execution_scope(other):
        assert not audio.get_generation_status()['running']
        assert not audio.start_generation_async()
        assert store.latest_job(other, 'podcast') is None


def test_queued_podcast_from_stopped_worker_is_interrupted_and_releases_reservation(owner, monkeypatch):
    monkeypatch.setattr(audio.threading, 'Thread', Mock())
    with execution_scope(owner):
        assert audio.start_generation_async()
        job = store.latest_job(owner, 'podcast')
        with store.connect() as db:
            db.execute("UPDATE agent_runs SET request=json_set(request,'$._worker_instance','stopped-fixture') WHERE run_id=?", (job.run_id,))
        audio._generation_states.clear()
        assert audio.get_generation_status()['error'] == 'worker_stopped'
        assert not audio.get_generation_status()['running']
        assert audio.start_generation_async()


def test_two_simultaneous_durable_reservations_have_one_winner(owner):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    barrier = Barrier(2)
    def reserve(user):
        scope = owner.model_copy(update={'user_id': user})
        snapshot = AgentExecutionSnapshot(scope=scope, agent_id='personal', profile={'id': 'personal'}, skill_ids=[], instructions=[], catalog_revision='1', revision='1')
        barrier.wait(timeout=5)
        try:
            execution.create_job_run(snapshot, user, 'podcast')
            return 'reserved'
        except ValueError as error:
            return str(error)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(reserve, ['alice', 'bob']))
    assert sorted(results) == ['podcast_generation_already_running', 'reserved']


def test_resuming_private_job_cannot_overwrite_another_owners_active_publication(owner):
    snapshot = AgentExecutionSnapshot(scope=owner, agent_id='personal', profile={'id': 'personal'}, skill_ids=[], instructions=[], catalog_revision='1', revision='1', behavior_resources={'fixture': 'procedure'})
    execution.create_job_run(snapshot, 'stopped', 'podcast')
    store.update(owner, 'stopped', status='failed')
    other = owner.model_copy(update={'user_id': 'bob'})
    execution.create_job_run(snapshot.model_copy(update={'scope': other}), 'active', 'podcast')
    with pytest.raises(ValueError, match='already_running'):
        store.resume_data(owner, 'stopped')
    assert store.read(owner, 'stopped').status == 'failed'


def test_snapshot_preparation_failure_releases_memory_reservation(owner, monkeypatch):
    monkeypatch.setattr(audio, '_resolve_podcast_llm', Mock(side_effect=RuntimeError('prepare failed')))
    with execution_scope(owner), pytest.raises(RuntimeError, match='prepare failed'):
        audio.start_generation_async()
    with execution_scope(owner):
        assert not audio.get_generation_status()['running']
        assert store.latest_job(owner, 'podcast') is None


def test_session_entry_failure_marks_acknowledged_job_failed(owner, monkeypatch):
    from contextlib import contextmanager
    @contextmanager
    def fail_session(snapshot):
        raise RuntimeError('session failed')
        yield
    monkeypatch.setattr(execution, 'operation_session', fail_session)
    snapshot, _, _ = audio._resolve_podcast_llm()
    snapshot = execution.create_job_run(snapshot, 'session-failure', 'podcast')
    with execution_scope(owner), pytest.raises(RuntimeError, match='session failed'):
        audio.generate_daily_podcast(snapshot)
    assert store.read(owner, 'session-failure').status == 'failed'


def test_cancellation_during_tts_keeps_previous_episode_and_removes_partial(owner, monkeypatch, tmp_path):
    snapshot, _, _ = audio._resolve_podcast_llm()
    snapshot = execution.create_job_run(snapshot, 'cancel-publish', 'podcast')
    output = tmp_path / 'episode.mp3'
    output.write_bytes(b'previous complete episode')
    def generate(text, partial, language):
        Path(partial).write_bytes(b'new complete audio')
        store.update(owner, 'cancel-publish', status='cancelled')
        with store.connect() as db:
            db.execute('UPDATE agent_runs SET cancelled=1 WHERE run_id=?', ('cancel-publish',))
    monkeypatch.setattr(audio, '_generate_tts_by_sentences', generate)
    from backend.services.agent_cancellation import AgentTurnCancelled
    with execution_scope(owner), pytest.raises(AgentTurnCancelled):
        audio._generate_tts_atomically('Fixture', output, 'ca', before_publish=lambda: audio._check_podcast_publication(snapshot))
    assert output.read_bytes() == b'previous complete episode'
    assert not Path(f'{output}.part').exists()


def test_revoked_scope_during_tts_keeps_previous_episode(owner, monkeypatch, tmp_path):
    snapshot, _, _ = audio._resolve_podcast_llm()
    output = tmp_path / 'episode.mp3'
    output.write_bytes(b'previous')
    def generate(text, partial, language):
        Path(partial).write_bytes(b'new')
        monkeypatch.setattr('backend.services.agent_execution_scope.revalidate_scope', Mock(side_effect=PermissionError('revoked')))
    monkeypatch.setattr(audio, '_generate_tts_by_sentences', generate)
    with execution_scope(owner), pytest.raises(PermissionError, match='revoked'):
        audio._generate_tts_atomically('Fixture', output, 'ca', before_publish=lambda: audio._check_podcast_publication(snapshot))
    assert output.read_bytes() == b'previous'
    assert not Path(f'{output}.part').exists()


def test_resumed_worker_keeps_scope_and_clears_previous_error(owner, monkeypatch):
    from contextlib import contextmanager
    @contextmanager
    def session(snapshot):
        yield
    class ImmediateThread:
        def __init__(self, target, args=(), **kwargs):
            self.invoke = lambda: target(*args)
        def start(self):
            self.invoke()
    snapshot, _, _ = audio._resolve_podcast_llm()
    snapshot = execution.create_job_run(snapshot, 'resume-clean', 'podcast')
    store.update(owner, 'resume-clean', status='resuming')
    monkeypatch.setattr(execution, 'operation_session', session)
    monkeypatch.setattr(audio.threading, 'Thread', ImmediateThread)
    def generate():
        from backend.services.agent_execution_scope import current_scope
        assert current_scope() == owner
        assert audio._generation_state()['error'] is None
        return 'fixture-episode.mp3'
    monkeypatch.setattr(audio, '_generate_daily_podcast', generate)
    with execution_scope(owner):
        audio._generation_state()['error'] = 'previous failure'
        audio.resume_podcast(snapshot)
        assert audio.get_generation_status()['result_filename'] == 'fixture-episode.mp3'
    assert store.read(owner, 'resume-clean').status == 'completed'


def test_cancel_between_validation_and_replace_keeps_previous_audio(owner, monkeypatch, tmp_path):
    snapshot, _, _ = audio._resolve_podcast_llm()
    snapshot = execution.create_job_run(snapshot, 'cancel-boundary', 'podcast')
    target = tmp_path / 'episode.mp3'
    staged = tmp_path / 'staged.mp3'
    target.write_bytes(b'previous')
    staged.write_bytes(b'new')
    original = audio._check_podcast_publication
    def cancel_after_validation(frozen):
        original(frozen)
        store.cancel(owner, frozen.parent_run_id)
    monkeypatch.setattr(audio, '_check_podcast_publication', cancel_after_validation)
    from backend.services.agent_cancellation import AgentTurnCancelled
    with execution_scope(owner), pytest.raises(AgentTurnCancelled):
        audio._publish_podcast_audio(snapshot, staged, target)
    assert target.read_bytes() == b'previous'
    assert staged.read_bytes() == b'new'


def test_publication_and_cancellation_are_serialized(owner, monkeypatch, tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    snapshot, _, _ = audio._resolve_podcast_llm()
    snapshot = execution.create_job_run(snapshot, 'serial-publication', 'podcast')
    entered = Event()
    release = Event()
    cancellation_started = Event()
    target = tmp_path / 'episode.mp3'
    staged = tmp_path / 'staged.mp3'
    target.write_bytes(b'previous')
    staged.write_bytes(b'new')
    original_replace = audio.os.replace
    def blocked_replace(source, destination):
        entered.set()
        assert release.wait(5)
        original_replace(source, destination)
    monkeypatch.setattr(audio.os, 'replace', blocked_replace)
    def publish():
        with execution_scope(owner):
            audio._publish_podcast_audio(snapshot, staged, target)
    def cancel():
        cancellation_started.set()
        store.cancel(owner, snapshot.parent_run_id)
    with ThreadPoolExecutor(max_workers=2) as workers:
        publication = workers.submit(publish)
        assert entered.wait(5)
        cancellation = workers.submit(cancel)
        try:
            assert cancellation_started.wait(5)
            assert not cancellation.done()
        finally:
            release.set()
        publication.result(timeout=5)
        cancellation.result(timeout=5)
    assert target.read_bytes() == b'new'
    assert store.cancelled(owner, snapshot.parent_run_id)


def test_timeout_with_empty_message_is_failed_instead_of_completed(owner, monkeypatch):
    from contextlib import contextmanager
    snapshot, _, _ = audio._resolve_podcast_llm()
    snapshot = execution.create_job_run(snapshot, 'empty-timeout', 'podcast')
    @contextmanager
    def session(frozen):
        yield
    def database():
        yield Mock()
    monkeypatch.setattr(execution, 'operation_session', session)
    monkeypatch.setattr('backend.data.db.get_db', database)
    monkeypatch.setattr(audio, '_resolve_podcast_llm', Mock(side_effect=TimeoutError()))
    with execution_scope(owner):
        assert audio.generate_daily_podcast(snapshot) is None
        assert audio.get_generation_status()['error'] == 'TimeoutError'
    assert store.read(owner, snapshot.parent_run_id).status == 'failed'
