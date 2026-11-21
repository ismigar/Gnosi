"""The same metering and timing boundary serves ordinary chat and structured operations."""
import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from langchain_openai import ChatOpenAI

from backend.agent import model_catalog, model_router
from backend.services import ai_usage_ledger, ai_usage_transport, reading_budget


def test_current_cloud_tariff_needs_no_live_discovery(tmp_path, monkeypatch):
    path = tmp_path / "catalog.json"
    monkeypatch.setattr(model_catalog, "_cache_path", lambda: path)
    monkeypatch.setattr(model_catalog, "_mem_cache", None)
    discoveries = []
    monkeypatch.setattr(model_catalog, "load_catalog", lambda: discoveries.append(1) or {"providers": []})
    model = {"id": "custom", "cost_in": 2, "cost_out": 7, "pricing_known": True}
    catalog = {"schema": model_catalog.CATALOG_SCHEMA, "fetched_at": datetime.now(timezone.utc).isoformat(),
               "providers": [{"id": "remote", "models": [model]}]}
    path.write_text(json.dumps(catalog))
    with model_catalog._mem_lock:
        assert model_catalog.catalog_model_cost("remote", "custom", True) == {"cost_in": 2, "cost_out": 7}
    model["cost_in"] = 4
    path.write_text(json.dumps(catalog))
    assert model_catalog.catalog_model_cost("remote", "custom", True)["cost_in"] == 4
    assert not discoveries
    catalog["fetched_at"] = "2000-01-01T00:00:00+00:00"
    path.write_text(json.dumps(catalog))
    assert model_catalog.catalog_model_cost("remote", "custom", True) is None
    assert discoveries == [1]
    catalog["providers"] = [{"id": "openai", "models": None}]
    path.write_text(json.dumps(catalog))
    monkeypatch.setattr(model_catalog, "load_catalog", lambda: {"providers": [{"id": "remote", "models": [model]}]})
    assert model_catalog.catalog_model_cost("remote", "custom", True) == {"cost_in": 4, "cost_out": 7}
    catalog.update(fetched_at=datetime.now(timezone.utc).isoformat(),
                   providers=[{"id": "openai", "models": [{"id": []}]}])
    path.write_text(json.dumps(catalog))
    assert model_catalog.catalog_model_cost("openai", "gpt-6.2-sol", True) == {"cost_in": 2, "cost_out": 10}


def test_selected_route_uses_published_metadata_and_preserves_overrides(tmp_path, monkeypatch):
    from backend.config import app_config
    from backend.domains.agent.runtime_tools import _model_context_window, _model_supports_tools
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps({"schema": model_catalog.CATALOG_SCHEMA, "fetched_at": datetime.now(timezone.utc).isoformat(),
        "providers": [{"id": "remote", "models": [{"id": "custom", "tags": ["tools"], "context_window": 65000}]}]}))
    monkeypatch.setattr(model_catalog, "_cache_path", lambda: path)
    monkeypatch.setattr(model_catalog, "_mem_cache", None)
    monkeypatch.setattr(model_catalog, "load_catalog", lambda: pytest.fail("Unnecessary live discovery"))
    rows = []
    monkeypatch.setattr(app_config, "load_params", lambda **_: SimpleNamespace(get=lambda *_: {"models": rows}))
    assert _model_context_window("remote", "custom") == 65000
    assert _model_supports_tools("remote", "custom", {})
    row = {"provider": "Remote", "model_id": "custom"}
    rows.append(row)
    assert _model_context_window("Remote", "custom") == 65000
    assert _model_supports_tools("Remote", "custom", {})
    row.update(context_window=9000, tags=[])
    assert _model_context_window("Remote", "custom") == 9000
    assert not _model_supports_tools("Remote", "custom", {})
    assert _model_supports_tools("Remote", "custom", {"capabilities": ["tools"]})


@pytest.mark.parametrize("asynchronous", [True, False])
def test_http_timings_follow_each_real_sdk_call(tmp_path, monkeypatch, asynchronous):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda *_: None)
    monkeypatch.setattr(model_router, "load_registry", lambda **_: [])
    from backend.services import artificial_analysis
    monkeypatch.setattr(artificial_analysis, "_read_cache", lambda: {})
    monkeypatch.setattr(ai_usage_ledger, "context_metadata", lambda: dict.fromkeys(
        ("agent_id", "agent_name", "operation", "origin", "run_id", "workspace_id", "user_id", "profile"), ""))

    def respond(request):
        prompt = json.loads(request.content)["messages"][-1]["content"]
        return httpx.Response(200, headers={"openai-processing-ms": "3", "x-private": "sensitive"},
            json={"id": "test", "object": "chat.completion", "created": 1, "model": "fixture",
                  "choices": [{"index": 0, "message": {"role": "assistant", "content": prompt}, "finish_reason": "stop"}],
                  "usage": {"prompt_tokens": 4, "completion_tokens": 1, "total_tokens": 5}})

    def model(**clients):
        return ai_usage_transport.instrument(ChatOpenAI(model="fixture", api_key="test", max_retries=0,
            base_url="https://test.invalid", **clients), "openai", "fixture")

    async def send():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await model(http_async_client=client).ainvoke("Quant fan dos i dos?")

    if asynchronous:
        reply = asyncio.run(send())
        assert reply.content == "Quant fan dos i dos?"
    else:
        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            reply = model(http_client=client).invoke("Hola")
            assert reply.content == "Hola"
    timing = reply.response_metadata["gnosi_provider_timing"]
    assert timing["provider_processing_ms"] == 3
    assert timing["before_sdk_ms"] >= 0 and timing["sdk_roundtrip_ms"] >= 0
    assert set(timing) <= {"before_sdk_ms", "sdk_roundtrip_ms", "provider_processing_ms", "http_roundtrip_ms"}


def test_configured_metering_skips_hydration_and_protected_calls_keep_it(monkeypatch):
    from contextvars import ContextVar
    from backend.config import app_config
    from backend.services import artificial_analysis
    monkeypatch.setattr(ai_usage_transport, "_active", ContextVar("test_call", default=None))
    monkeypatch.setattr(app_config, "load_params", lambda **_: SimpleNamespace(
        get=lambda *_: {"models": [{"provider": "p", "model_id": "m", "cost_in": 2, "cost_out": 9, "profile": "manual"}]}))
    monkeypatch.setattr(ai_usage_ledger, "context_metadata", lambda: {})
    monkeypatch.setattr(artificial_analysis, "_read_cache", lambda: {})
    lookups = []
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda p, m, prefer: lookups.append(prefer))
    hydrated = []
    monkeypatch.setattr(model_catalog, "catalog_model_metadata_index", lambda: hydrated.append(True) or {})
    monkeypatch.setattr(reading_budget, "reserve", lambda *args: None)
    callback = ai_usage_transport.UsageCallback("p", "m")
    for active in (False, True):
        monkeypatch.setattr(reading_budget, "active", lambda: active)
        callback.on_chat_model_start({}, [], run_id=str(active))
        state = callback.pending[str(active)]
        assert state["rates"] == {"cost_in": 2, "cost_out": 9}
        assert state["attribution"]["profile"] == "manual"
    assert lookups == [True, False]
    assert hydrated == [True]


def test_slow_statistics_follow_the_response_and_stay_with_the_original_call(tmp_path, monkeypatch):
    from concurrent.futures import Future
    from backend.services import artificial_analysis
    class PendingProfile(Future):
        def result(self, timeout=1):
            return super().result(timeout)
    pending = PendingProfile()
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(artificial_analysis, "route_profiles", lambda: pending)
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda *_: {"cost_in": 2, "cost_out": 7})
    monkeypatch.setattr(model_router, "load_registry", lambda **_: [])
    monkeypatch.setattr(ai_usage_ledger, "context_metadata", lambda: dict.fromkeys(
        ("agent_id", "agent_name", "operation", "origin", "run_id", "workspace_id", "user_id", "profile"), ""))
    callback = ai_usage_transport.UsageCallback("remote", "model")
    callback.on_chat_model_start({}, [], run_id="first")
    callback.on_llm_error(RuntimeError("fixture"), run_id="first")
    with ai_usage_ledger.connect() as db:
        before = dict(db.execute("SELECT * FROM usage_calls WHERE id='first'").fetchone())
    assert before["profile"] == "unrated" and before["status"] == "failed"
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "other"))
    import sqlite3
    from contextlib import closing
    with closing(sqlite3.connect(tmp_path / "llm_usage.sqlite")) as writer:
        writer.execute("BEGIN IMMEDIATE")
        pending.set_result({("remote", "model"): "expert"})
        writer.commit()
    ai_usage_ledger.flush_call_profiles()
    assert not (tmp_path / "other").exists()
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    with ai_usage_ledger.connect() as db:
        after = dict(db.execute("SELECT * FROM usage_calls WHERE id='first'").fetchone())
    assert after == {**before, "profile": "expert"}


def test_concurrent_profile_lookups_share_one_read_per_report(tmp_path, monkeypatch):
    import threading
    from backend.services import artificial_analysis as analysis
    report = tmp_path / "comparison.json"
    monkeypatch.setattr(analysis, "_cache_path", lambda: report)
    data = {"models": [{"profile": "first", "routes": [{"provider": "p", "model_id": "m"}]}]}
    report.write_text(json.dumps(data))
    read = analysis._read_route_profiles
    proceed = threading.Event()
    reads = []
    def delayed(stream):
        reads.append(1)
        assert proceed.wait(3)
        return read(stream)
    monkeypatch.setattr(analysis, "_read_route_profiles", delayed)
    try:
        first = analysis.route_profiles()
        assert analysis.route_profiles() is first
        data["models"][0]["profile"] = "second"
        analysis._write_cache(data)
        second = analysis.route_profiles()
        assert second is not first
    finally:
        proceed.set()
    assert first.result(3) == {("p", "m"): "first"}
    assert second.result(3) == {("p", "m"): "second"}
    assert len(reads) == 2


@pytest.mark.parametrize("failure", [RecursionError(), None])
def test_failed_profile_statistics_do_not_lose_real_usage(tmp_path, monkeypatch, failure):
    from concurrent.futures import Future
    from backend.services import artificial_analysis
    lookup = Future()
    if failure is None:
        lookup.cancel()
    else:
        lookup.set_exception(failure)
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(artificial_analysis, "route_profiles", lambda: lookup)
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda *_: None)
    monkeypatch.setattr(model_router, "load_registry", lambda **_: [])
    monkeypatch.setattr(ai_usage_ledger, "context_metadata", lambda: dict.fromkeys(
        ("agent_id", "agent_name", "operation", "origin", "run_id", "workspace_id", "user_id", "profile"), ""))
    callback = ai_usage_transport.UsageCallback("fixture", "model")
    callback.on_chat_model_start({}, [], run_id="paid")
    ai_usage_transport.observe({"model": "model", "usage": {"prompt_tokens": 13, "completion_tokens": 4, "cost": 0.021}})
    callback.on_llm_end(SimpleNamespace(generations=[]), run_id="paid")
    with ai_usage_ledger.connect() as db:
        row = db.execute("SELECT input_tokens,output_tokens,cost_usd,profile FROM usage_calls WHERE id='paid'").fetchone()
    assert tuple(row) == (13, 4, "0.021", "unrated")


def test_graceful_exit_finishes_accepted_usage_updates(tmp_path, monkeypatch):
    import os
    import subprocess
    import sys
    from textwrap import dedent
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    ai_usage_ledger.write_call(provider="remote", model_id="model", call_id="paid", input_tokens=13,
                               output_tokens=4, cost_usd="0.021", cost_source="reported", settle_budget=False)
    # A separate interpreter exits while the real comparison read is still pending.
    program = dedent("""
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        from time import sleep
        from backend.services.ai_usage_ledger import complete_call_profile
        exiting = Event()
        def classify():
            exiting.wait()
            sleep(0.2)
            return {("remote", "model"): "expert"}
        profiles = ThreadPoolExecutor(max_workers=1).submit(classify)
        complete_call_profile("paid", ("remote", "model"), profiles)
        exiting.set()
    """)
    subprocess.run([sys.executable, "-c", program], env=os.environ.copy(), check=True, timeout=20)
    with ai_usage_ledger.connect() as db:
        result = db.execute("SELECT profile,input_tokens,output_tokens,cost_usd FROM usage_calls WHERE id='paid'")
        assert tuple(result.fetchone()) == ("expert", 13, 4, "0.021")


def test_ordinary_metering_combines_configured_and_published_tariffs(tmp_path, monkeypatch):
    from backend.config import app_config
    catalog = model_catalog.build_catalog({"remote": {"models": {"model": {
        "id": "model", "name": "model", "cost": {"output": 5}}}}})
    catalog["fetched_at"] = datetime.now(timezone.utc).isoformat()
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog))
    monkeypatch.setattr(model_catalog, "_cache_path", lambda: path)
    monkeypatch.setattr(model_catalog, "_mem_cache", None)
    monkeypatch.setattr(model_catalog, "load_catalog", lambda: pytest.fail("Unnecessary live discovery"))
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    row = {"provider": "remote", "model_id": "model", "cost_in": 3, "profile": "manual"}
    monkeypatch.setattr(app_config, "load_params", lambda **_: SimpleNamespace(paths={}, get=lambda *_: {"models": [row]}))
    callback = ai_usage_transport.UsageCallback("remote", "model")
    callback.on_chat_model_start({}, [], run_id="paid")
    ai_usage_transport.observe({"model": "model", "usage": {"prompt_tokens": 10, "completion_tokens": 20}})
    callback.on_llm_end(SimpleNamespace(generations=[]), run_id="paid")
    with ai_usage_ledger.connect() as db:
        assert tuple(db.execute("SELECT cost_usd,cost_source FROM usage_calls WHERE id='paid'").fetchone()) == (
            "0.00013", "estimated")
