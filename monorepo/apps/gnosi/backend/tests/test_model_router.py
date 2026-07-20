"""Tests for the model router (pure logic + usage counter). No backend or network."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.model_router import (  # noqa: E402
    classify_request, route_model, model_cost_rates, usage_from_message,
    UsageStore, DEFAULT_REGISTRY,
)

ALL_UP = lambda provider: True  # all providers available
ONLY = lambda *names: (lambda p: p in names)


def test_classify():
    assert classify_request("hola, què tal?")["desired_quality"] == 1
    c = classify_request("Analitza i compara l'arquitectura del sistema de routing")
    assert c["desired_quality"] == 3
    code = classify_request("tinc un bug a la funció python del test")
    assert "code" in code["needs"] and code["desired_quality"] == 3
    assert "long" in classify_request("resum", context_tokens=20000)["needs"]
    assert "vision" in classify_request("què hi ha aquí", has_images=True)["needs"]


def test_simple_request_picks_cheap_fast():
    d = route_model("hola?", is_available=ALL_UP)
    # quality 1 → should pick a cheap/fast model (quality 1)
    assert d["model_id"] in ("llama-3.1-8b-instant", "llama3.2:latest")


def test_complex_request_picks_high_quality():
    d = route_model("Analitza en profunditat la complexitat del disseny i proposa millores",
                    is_available=ALL_UP)
    model = next(m for m in DEFAULT_REGISTRY if m["model_id"] == d["model_id"])
    assert model["quality"] == 3


def test_code_request_requires_code_capability():
    d = route_model("ajuda'm amb aquest bug de python al codi", is_available=ALL_UP)
    model = next(m for m in DEFAULT_REGISTRY if m["model_id"] == d["model_id"])
    assert "code" in model["tags"]


def test_availability_filters():
    # only anthropic alive → should pick an anthropic model
    d = route_model("Analitza això a fons i compara opcions", is_available=ONLY("anthropic"))
    assert d["provider"] == "anthropic"


def test_budget_tight_prefers_local():
    d = route_model("Analitza i dissenya l'arquitectura completa", is_available=ALL_UP,
                    budget={"prefer_local": True})
    model = next(m for m in DEFAULT_REGISTRY if m["model_id"] == d["model_id"])
    assert model["is_local"] is True
    assert d["reason"] == "budget→local"


def test_budget_remaining_below_threshold_prefers_local():
    d = route_model("pregunta normal qualsevol", is_available=ALL_UP,
                    budget={"remaining_tokens": 500, "prefer_local_below": 1000})
    model = next(m for m in DEFAULT_REGISTRY if m["model_id"] == d["model_id"])
    assert model["is_local"] is True


def test_quota_exhausted_skips_model():
    usage = {"groq:llama-3.1-8b-instant": 999999}
    reg = [dict(m, monthly_quota=1000) for m in DEFAULT_REGISTRY if m["provider"] == "groq"]
    reg += [m for m in DEFAULT_REGISTRY if m["provider"] != "groq"]
    d = route_model("hola?", registry=reg, is_available=ALL_UP, usage=usage)
    assert d["model_id"] != "llama-3.1-8b-instant"  # esgotat → no es tria


def test_manual_override_respected():
    d = route_model("qualsevol", is_available=ALL_UP,
                    manual={"provider": "openai", "model_id": "gpt-4o"})
    assert d == {"provider": "openai", "model_id": "gpt-4o", "reason": "manual"}


def test_manual_override_ignored_if_provider_down():
    d = route_model("Analitza a fons", is_available=ONLY("groq"),
                    manual={"provider": "openai", "model_id": "gpt-4o"})
    assert d["provider"] == "groq"  # openai down → ignores manual and route


def test_no_provider_available():
    d = route_model("hola", is_available=lambda p: False)
    assert d["provider"] is None


def test_usage_store_roundtrip():
    with tempfile.TemporaryDirectory() as tmp:
        path = str(Path(tmp) / "usage.json")
        s = UsageStore(path)
        s.record("groq", "llama-3.1-8b-instant", 100, 50, "2026-06")
        s.record("groq", "llama-3.1-8b-instant", 10, 5, "2026-06")
        assert s.usage_for("2026-06")["groq:llama-3.1-8b-instant"] == 165
        # persistence: new instance reads from disk
        assert UsageStore(path).usage_for("2026-06")["groq:llama-3.1-8b-instant"] == 165


# ---------------------------------------------------------------------------
# Money cap (monthly spend ceiling in USD, injected by the caller)
# ---------------------------------------------------------------------------

def test_over_cap_restricts_to_free_models():
    d = route_model("Analitza a fons l'arquitectura", is_available=ALL_UP,
                    budget={"cost_cap_usd": 10.0, "spent_usd": 10.0})
    model = next(m for m in DEFAULT_REGISTRY if m["model_id"] == d["model_id"])
    assert model["is_local"] is True
    assert d["reason"] == "budget_cap→free"


def test_over_cap_without_free_models_reports_exhausted():
    paid_only = [m for m in DEFAULT_REGISTRY if not m["is_local"]]
    d = route_model("hola", registry=paid_only, is_available=ALL_UP,
                    budget={"cost_cap_usd": 5.0, "spent_usd": 7.5})
    assert d["provider"] is None
    assert d["reason"] == "budget_exhausted"


def test_near_cap_behaves_budget_tight():
    # 85% spent → not blocked, but local (cost 0) wins like prefer_local
    d = route_model("Analitza i dissenya l'arquitectura completa", is_available=ALL_UP,
                    budget={"cost_cap_usd": 10.0, "spent_usd": 8.5})
    model = next(m for m in DEFAULT_REGISTRY if m["model_id"] == d["model_id"])
    assert model["is_local"] is True


def test_under_cap_routes_normally():
    d = route_model("Analitza en profunditat la complexitat del disseny",
                    is_available=ALL_UP,
                    budget={"cost_cap_usd": 10.0, "spent_usd": 1.0})
    model = next(m for m in DEFAULT_REGISTRY if m["model_id"] == d["model_id"])
    assert model["quality"] == 3  # no degradation below 80%


# ---------------------------------------------------------------------------
# UsageStore v2: cost ledger, legacy format, concurrent writers
# ---------------------------------------------------------------------------

def test_usage_store_tracks_cost():
    with tempfile.TemporaryDirectory() as tmp:
        path = str(Path(tmp) / "usage.json")
        s = UsageStore(path)
        s.record("openai", "gpt-4o", 1000, 500, "2026-07", cost_usd=0.0075)
        s.record("openai", "gpt-4o", 1000, 500, "2026-07", cost_usd=0.0075)
        s.record("ollama", "llama3.2:latest", 800, 400, "2026-07", cost_usd=0.0)
        fresh = UsageStore(path)
        assert fresh.spend_usd("2026-07") == 0.015
        rows = fresh.rows("2026-07")
        assert rows[0]["provider"] == "openai" and rows[0]["cost_usd"] == 0.015
        assert rows[0]["in"] == 2000 and rows[0]["out"] == 1000
        assert fresh.spend_usd("2026-01") == 0.0


def test_usage_store_reads_legacy_plain_int_format():
    import json
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "usage.json"
        path.write_text(json.dumps({"2026-06": {"groq:old-model": 4200}}), encoding="utf-8")
        s = UsageStore(str(path))
        assert s.usage_for("2026-06")["groq:old-model"] == 4200
        assert s.spend_usd("2026-06") == 0.0
        # recording on top of a legacy entry upgrades it without losing tokens
        s.record("groq", "old-model", 100, 0, "2026-06", cost_usd=0.001)
        assert UsageStore(str(path)).usage_for("2026-06")["groq:old-model"] == 4300


def test_usage_store_concurrent_instances_do_not_lose_writes():
    # Two stale in-memory copies writing to the same file: the re-read under
    # the module lock must serialize them (RMW race pattern).
    import threading
    with tempfile.TemporaryDirectory() as tmp:
        path = str(Path(tmp) / "usage.json")
        stores = [UsageStore(path) for _ in range(4)]

        def worker(store):
            for _ in range(25):
                store.record("groq", "m", 1, 1, "2026-07", cost_usd=0.000001)

        threads = [threading.Thread(target=worker, args=(s,)) for s in stores]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert UsageStore(path).usage_for("2026-07")["groq:m"] == 200  # 4×25×(1+1)


def test_model_cost_rates_prefers_registry():
    reg = [{"provider": "groq", "model_id": "m", "cost_in": 1.5, "cost_out": 2.5}]
    assert model_cost_rates("groq", "m", reg) == (1.5, 2.5)


def test_model_cost_rates_falls_back_to_catalog_then_zero():
    # Patch the catalog loader: no network/disk in unit tests
    import backend.agent.model_catalog as mc
    original = mc.load_catalog
    mc.load_catalog = lambda force_refresh=False: {"providers": [
        {"id": "nope", "models": [{"id": "known", "cost_in": 9.0, "cost_out": 18.0}]},
    ]}
    try:
        assert model_cost_rates("nope", "known", []) == (9.0, 18.0)
        assert model_cost_rates("nope", "missing", []) == (0.0, 0.0)
    finally:
        mc.load_catalog = original


def test_usage_from_message_duck_typing():
    class Msg:
        usage_metadata = {"input_tokens": 12, "output_tokens": 34}

    class Empty:
        usage_metadata = None

    assert usage_from_message(Msg()) == (12, 34)
    assert usage_from_message(Empty()) is None
    assert usage_from_message(object()) is None


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
