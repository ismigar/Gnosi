"""Deferred plugin events retain the originating vault and authenticated scope."""
from threading import Event
from backend.services import plugin_events as events
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import current_scope, execution_scope
from backend.services.context_vars import get_active_vault_path


def test_deferred_plugin_dispatch_keeps_originating_scope_after_request_ends(monkeypatch, tmp_path):
    release = Event()
    complete = Event()
    observed = []
    owner = ExecutionScope(user_id='alice', workspace_id='team', role='owner', vault_path=str(tmp_path/'first'))
    other = owner.model_copy(update={'user_id':'bob', 'vault_path':str(tmp_path/'second')})
    def dispatch(event, data):
        try:
            assert release.wait(5)
            observed.append((event, data, current_scope(), get_active_vault_path()))
        finally:
            complete.set()
    monkeypatch.setattr(events, '_subscribers', [])
    monkeypatch.setattr(events, '_dispatcher', dispatch)
    with execution_scope(owner):
        events.emit('page:updated', {'page_id':'fixture'})
    with execution_scope(other):
        release.set()
        assert complete.wait(5)
    assert observed == [('page:updated', {'page_id':'fixture'}, owner, tmp_path/'first')]


def test_broken_subscriber_does_not_drop_scoped_plugin_dispatch(monkeypatch, tmp_path):
    complete = Event()
    observed = []
    owner = ExecutionScope(user_id='alice', workspace_id='team', role='owner', vault_path=str(tmp_path))
    def fail(event, data):
        raise RuntimeError('synthetic plugin error')
    def dispatch(event, data):
        observed.append(current_scope())
        complete.set()
    monkeypatch.setattr(events, '_subscribers', [fail])
    monkeypatch.setattr(events, '_dispatcher', dispatch)
    with execution_scope(owner):
        events.emit('page:created')
    assert complete.wait(5)
    assert observed == [owner]
