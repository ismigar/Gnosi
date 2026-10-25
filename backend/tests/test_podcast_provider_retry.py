"""Capacity cooldowns obey the current operation deadline rather than extending it."""
import asyncio
from types import SimpleNamespace

import httpx
import pytest
from openai import RateLimitError

from backend.services import podcast_provider_retry as retry


def error(headers):
    return RateLimitError('Capacity exhausted.', response=httpx.Response(429, headers=headers,
        request=httpx.Request('POST', 'https://provider.invalid')), body={'error': {'code': 429}})


@pytest.mark.parametrize('headers,remaining,expected', [
    ({'Retry-After': '45'}, 50, 45),
    ({'Retry-After-Ms': '55000'}, 60, 55),
    ({'Retry-After': '45'}, 45, None),
    ({'Retry-After': '300'}, 300, None),
    ({'Retry-After': 'inf'}, 300, None),
    ({'Retry-After': 'nan'}, 300, None),
    ({'x-ratelimit-limit-req-minute': '0'}, 300, None),
])
def test_server_cooldown_is_not_shortened_to_fit_the_deadline(monkeypatch, headers, remaining, expected):
    clock = [100.0];waits, traces = [], []
    monkeypatch.setattr(retry, 'monotonic', lambda: clock[0])
    async def sleep(seconds):
        waits.append(seconds);clock[0] += seconds
    monkeypatch.setattr(retry, 'sleep', sleep)
    monkeypatch.setattr('backend.services.agent_execution_trace.append', lambda *args: traces.append(args))
    failure = error(headers)
    work = retry.wait_for_capacity(failure, SimpleNamespace(operation='podcast.coverage.audit'),
        calls_left=1, deadline=100 + remaining, scope=None, run_id='fixture')
    if expected is None:
        with pytest.raises(RateLimitError) as caught:
            asyncio.run(work)
        assert caught.value is failure and waits == [] and traces == []
    else:
        asyncio.run(work)
        assert waits == [expected] and len(traces) == 1 and clock[0] < 100 + remaining


def test_elapsed_cooldown_does_not_create_a_fresh_deadline(monkeypatch):
    clock = [100.0];waits = []
    monkeypatch.setattr(retry, 'monotonic', lambda: clock[0])
    async def sleep(seconds):
        waits.append(seconds);clock[0] = 120
    monkeypatch.setattr(retry, 'sleep', sleep)
    monkeypatch.setattr('backend.services.agent_execution_trace.append', lambda *args: None)
    with pytest.raises(RateLimitError):
        asyncio.run(retry.wait_for_capacity(error({'Retry-After': '5'}),
            SimpleNamespace(operation='podcast.coverage.write'), calls_left=1, deadline=110,
            scope=None, run_id='fixture'))
    assert waits == [5]


def test_cancellation_interrupts_capacity_wait_without_waiting_for_cooldown(monkeypatch):
    from backend.services.agent_cancellation import create_cancel_token, cancel, release, AgentTurnCancelled
    token = create_cancel_token();waits = []
    async def sleep(seconds):
        waits.append(seconds)
        cancel(token)
        await asyncio.Event().wait()
    monkeypatch.setattr(retry, 'sleep', sleep)
    monkeypatch.setattr('backend.services.agent_execution_trace.append', lambda *args: None)
    async def exercise():
        await asyncio.wait_for(retry.wait_for_capacity(error({'Retry-After': '30'}),
            SimpleNamespace(operation='podcast.coverage.audit'), calls_left=1,
            deadline=retry.monotonic() + 60, scope=None, run_id='fixture', cancel_token=token), timeout=0.2)
    try:
        with pytest.raises(AgentTurnCancelled):
            asyncio.run(exercise())
    finally:
        release(token)
    assert waits == [30]
