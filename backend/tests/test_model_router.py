"""Tests for the model router (pure logic + usage counter). No backend or network."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent.model_router import (  # noqa: E402
    classify_request, route_model, UsageStore, DEFAULT_REGISTRY,
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
