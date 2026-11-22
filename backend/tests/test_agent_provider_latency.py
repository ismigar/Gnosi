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


def test_usage_commits_with_the_original_profile_before_restart(tmp_path, monkeypatch):
    from backend.services import artificial_analysis as analysis
    report = tmp_path / "comparison.json"
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(analysis, "_cache_path", lambda: report)
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda *_: None)
    monkeypatch.setattr(model_router, "load_registry", lambda **_: [])
    data = {"models": [{"profile": "expert", "routes": [{"provider": "remote", "model_id": "model"}]}]}
    analysis._write_cache(data)
    callback = ai_usage_transport.UsageCallback("remote", "model")
    for call in ("paid", "failed"):
        callback.on_chat_model_start({}, [], run_id=call)
    data["models"][0]["profile"] = "worker"
    analysis._write_cache(data)
    monkeypatch.setattr(analysis, "published_route_profile", lambda *_: pytest.fail("Profile lookup after model response"))
    ai_usage_transport.observe({"model": "model", "usage": {"prompt_tokens": 13, "completion_tokens": 4, "cost": 0.021}},
                               state=callback.pending["paid"])
    callback.on_llm_end(SimpleNamespace(generations=[]), run_id="paid")
    callback.on_llm_error(RuntimeError("fixture"), run_id="failed")
    with ai_usage_ledger.connect() as db:
        assert tuple(db.execute("SELECT profile,input_tokens,output_tokens,cost_usd FROM usage_calls WHERE id='paid'").fetchone()) == ("expert", 13, 4, "0.021")
        assert tuple(db.execute("SELECT profile,status FROM usage_calls WHERE id='failed'").fetchone()) == ("expert", "failed")


def test_current_profile_index_survives_restart_and_rebuilds_for_replaced_reports(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from backend.services import artificial_analysis as analysis, model_profile_index
    report = tmp_path / "comparison.json"
    monkeypatch.setattr(analysis, "_cache_path", lambda: report)
    data = {"models": [{"profile": "first", "routes": [{"provider": "p", "model_id": "m"}]}]}
    report.write_text(json.dumps(data))
    make_index = model_profile_index._index_model_profiles
    reads = []
    def counted(payload):
        reads.append(1)
        return make_index(payload)
    monkeypatch.setattr(model_profile_index, "_index_model_profiles", counted)
    with ThreadPoolExecutor(4) as pool:
        assert list(pool.map(lambda _: analysis.published_route_profile("p", "m"), range(8))) == ["first"] * 8
    assert reads == [1]
    monkeypatch.setattr(model_profile_index, "_profiles_source", None)
    assert analysis.published_route_profile("p", "m") == "first"
    assert reads == [1]
    data["models"][0]["profile"] = "second"
    analysis._write_cache(data)
    monkeypatch.setattr(model_profile_index, "_profiles_source", None)
    assert analysis.published_route_profile("p", "m") == "second"
    assert reads == [1, 1]
    sidecar = report.with_name(report.name + ".profiles-v1.json")
    sidecar.write_text("{")
    monkeypatch.setattr(model_profile_index, "_profiles_source", None)
    assert analysis.published_route_profile("p", "m") == "second"
    assert reads == [1, 1, 1]


@pytest.mark.parametrize("failure", [RecursionError(), OSError()])
def test_failed_profile_statistics_do_not_lose_real_usage(tmp_path, monkeypatch, failure):
    from backend.services import artificial_analysis as analysis
    def failed_lookup(*_):
        raise failure
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(analysis, "published_route_profile", failed_lookup)
    monkeypatch.setattr(model_catalog, "catalog_model_cost", lambda *_: None)
    monkeypatch.setattr(model_router, "load_registry", lambda **_: [])
    callback = ai_usage_transport.UsageCallback("fixture", "model")
    callback.on_chat_model_start({}, [], run_id="paid")
    ai_usage_transport.observe({"model": "model", "usage": {"prompt_tokens": 13, "completion_tokens": 4, "cost": 0.021}})
    callback.on_llm_end(SimpleNamespace(generations=[]), run_id="paid")
    with ai_usage_ledger.connect() as db:
        row = db.execute("SELECT input_tokens,output_tokens,cost_usd,profile FROM usage_calls WHERE id='paid'").fetchone()
        assert tuple(row) == (13, 4, "0.021", "unrated")


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
