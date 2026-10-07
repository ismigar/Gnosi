"""Delayed provider billing must release only provider-confirmed reservations."""
from __future__ import annotations

import heapq
import io
import json
import urllib.error

import pytest

from backend.services import ai_usage_ledger as ledger, ai_usage_openrouter as billing, reading_budget


@pytest.fixture
def pending(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(ledger, "context_metadata", lambda: {
        "agent_id": "test", "agent_name": "", "operation": "reading", "origin": "test",
        "profile": "", "run_id": "", "workspace_id": "test", "user_id": "test"})
    monkeypatch.setattr(billing, "_pending", [])
    monkeypatch.setattr(billing, "_active_calls", set())
    monkeypatch.setattr(billing, "_workers_started", True)
    identifier = reading_budget.configure(1)
    with reading_budget.session(identifier):
        reading_budget.reserve("paid", [], {"max_tokens": 100}, {"cost_in": 1, "cost_out": 1}, "openrouter")
    ledger.write_call(provider="openrouter", model_id="test", call_id="paid", generation_id="gen-paid",
                      input_tokens=10, output_tokens=2, cost_usd="0.001", cost_source="estimated")
    return identifier


def test_delayed_generation_metadata_settles_without_repeating_model(pending, monkeypatch):
    requests = []
    def respond(request, **kwargs):
        requests.append(request)
        if len(requests) < 3:
            raise urllib.error.HTTPError(request.full_url, 404, "not ready", {}, None)
        return io.StringIO(json.dumps({"data": {"id": "gen-paid", "total_cost": .0007}}))
    monkeypatch.setattr(billing.urllib.request, "urlopen", respond)
    billing.schedule("paid", "gen-paid", "secret")
    for attempt in range(3):
        _, _, call_id, generation, key, retry = heapq.heappop(billing._pending)
        assert retry == attempt
        billing._attempt(call_id, generation, key, retry)
        if attempt < 2:
            assert reading_budget.status(pending)["reserved_usd"] > 0
    assert not billing._pending and not billing._active_calls
    assert reading_budget.status(pending)["reserved_usd"] == 0
    assert reading_budget.status(pending)["spent_usd"] == .0007
    assert all(request.get_method() == "GET" for request in requests)
    with ledger.connect() as db:
        assert db.execute("SELECT count(*) FROM usage_calls").fetchone()[0] == 1
        assert db.execute("SELECT cost_source FROM usage_calls").fetchone()[0] == "reported"


def test_unavailable_cost_is_bounded_and_never_treated_as_free(pending, monkeypatch):
    requests = []
    def unavailable(request, **kwargs):
        requests.append(request)
        raise urllib.error.HTTPError(request.full_url, 404, "not ready", {}, None)
    monkeypatch.setattr(billing.urllib.request, "urlopen", unavailable)
    billing.schedule("paid", "gen-paid", "secret")
    while billing._pending:
        _, _, call_id, generation, key, retry = heapq.heappop(billing._pending)
        billing._attempt(call_id, generation, key, retry)
    assert len(requests) == len(billing._RETRY_DELAYS) + 1
    assert not billing._active_calls
    assert reading_budget.status(pending)["reserved_usd"] > 0
    assert reading_budget.status(pending)["spent_usd"] == 0


def test_waiting_metadata_does_not_block_new_lookups_or_duplicate_reservations(pending, monkeypatch):
    monkeypatch.setattr(billing, "reconcile", lambda *args: False)
    monkeypatch.setattr(billing.time, "monotonic", lambda: 100)
    billing.schedule("paid", "gen-paid", "secret")
    _, _, call_id, generation, key, retry = heapq.heappop(billing._pending)
    billing._attempt(call_id, generation, key, retry)
    billing.schedule("paid", "gen-paid", "secret")
    billing.schedule("new", "gen-new", "secret")
    assert len(billing._pending) == 2
    assert heapq.heappop(billing._pending)[2] == "new"
    assert heapq.heappop(billing._pending)[0] > 100
