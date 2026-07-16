"""Unit tests for the provider→model catalog transform (backend/agent/model_catalog.py).

Pure functions only — no network, no disk (cf. memory
`feedback_local_backend_test_verification`).
"""
from backend.agent.model_catalog import (
    CATALOG_PROVIDERS,
    build_catalog,
    merge_ollama_overlay,
    pick_ping_model,
    _infer_quality,
    _infer_tags,
)


def _models_dev_sample():
    return {
        "groq": {
            "id": "groq", "name": "Groq",
            "models": {
                "llama-3.1-8b-instant": {
                    "id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B Instant",
                    "tool_call": True, "reasoning": False, "attachment": False,
                    "modalities": {"input": ["text"], "output": ["text"]},
                    "cost": {"input": 0.05, "output": 0.08},
                    "limit": {"context": 131072, "output": 8192},
                    "release_date": "2024-07-23",
                },
            },
        },
        # models.dev id differs from Gnosi's ("togetherai" → "together")
        "togetherai": {
            "id": "togetherai", "name": "Together AI",
            "models": {
                "big-model": {
                    "id": "big-model", "name": "Big Model",
                    "tool_call": False, "reasoning": True, "attachment": True,
                    "modalities": {"input": ["text", "image"], "output": ["text"]},
                    "cost": {"input": 3.0, "output": 15.0},
                    "limit": {"context": 200000},
                    "release_date": "2026-01-01",
                },
                "img-only": {
                    "id": "img-only", "name": "Image Gen",
                    "modalities": {"input": ["text"], "output": ["image"]},
                },
            },
        },
        "not-in-whitelist": {
            "id": "not-in-whitelist", "name": "Nope",
            "models": {"m": {"id": "m", "name": "M"}},
        },
    }


def test_build_catalog_whitelists_aliases_and_filters_non_text():
    catalog = build_catalog(_models_dev_sample())
    ids = [p["id"] for p in catalog["providers"]]
    assert ids == ["groq", "together"]  # whitelist order, alias applied, no 'nope'
    together = catalog["providers"][1]
    assert [m["id"] for m in together["models"]] == ["big-model"]  # image-only filtered
    assert together["is_local"] is False


def test_build_catalog_maps_cost_context_and_tags():
    catalog = build_catalog(_models_dev_sample())
    groq_model = catalog["providers"][0]["models"][0]
    assert groq_model["cost_in"] == 0.05 and groq_model["cost_out"] == 0.08
    assert groq_model["context_window"] == 131072
    # instant name + cheap output → fast; 131k context → long; tool_call → tools
    assert set(groq_model["tags"]) == {"fast", "long", "tools"}
    assert groq_model["quality"] == 1

    big = catalog["providers"][1]["models"][0]
    assert set(big["tags"]) == {"vision", "long", "reasoning"}
    assert big["quality"] == 3


def test_infer_tags_code_and_reasoning():
    tags = _infer_tags({
        "id": "qwen-coder", "name": "Qwen Coder", "tool_call": True,
        "reasoning": True, "cost": {"output": 0.4},
        "modalities": {"input": ["text"]}, "limit": {"context": 32768},
    })
    assert set(tags) == {"fast", "code", "tools", "reasoning"}


def test_infer_quality_buckets():
    assert _infer_quality({"cost": {"input": 0.05, "output": 0.08}}) == 1
    assert _infer_quality({"cost": {"input": 0.5, "output": 1.5}}) == 2
    assert _infer_quality({"cost": {"input": 3, "output": 15}}) == 3
    # reasoning bumps cheap models to at least 2, expensive ones to 3
    assert _infer_quality({"cost": {"input": 0.1, "output": 0.4}, "reasoning": True}) == 2
    assert _infer_quality({"cost": {"input": 2, "output": 8}, "reasoning": True}) == 3


def test_pick_ping_model_cheapest_wins():
    catalog = {"providers": [
        {"id": "groq", "models": [
            {"id": "big", "cost_in": 3.0, "cost_out": 15.0},
            {"id": "cheap-new", "cost_in": 0.05, "cost_out": 0.08},
            {"id": "cheap-old", "cost_in": 0.05, "cost_out": 0.08},
        ]},
        {"id": "empty", "models": []},
        {"id": "ollama", "models": [{"id": "llama3.2:latest", "cost_in": 0, "cost_out": 0}]},
    ]}
    # cheapest wins; tie keeps the first entry (newest, list is sorted newest-first)
    assert pick_ping_model(catalog, "groq") == "cheap-new"
    # local models cost 0 → the installed one is picked
    assert pick_ping_model(catalog, "ollama") == "llama3.2:latest"
    assert pick_ping_model(catalog, "empty") is None
    assert pick_ping_model(catalog, "unknown") is None


def test_merge_ollama_overlay_replaces_and_orders():
    catalog = build_catalog(_models_dev_sample())
    live = [{"id": "llama3.2:latest", "name": "llama3.2:latest", "cost_in": 0,
             "cost_out": 0, "context_window": 8192, "tags": [], "quality": 1,
             "release_date": ""}]
    merged = merge_ollama_overlay(catalog, live)
    ollama = next(p for p in merged["providers"] if p["id"] == "ollama")
    assert ollama["live"] is True and ollama["is_local"] is True
    assert ollama["models"] == live
    # canonical order preserved (ollama before lmstudio, after cloud providers)
    ids = [p["id"] for p in merged["providers"]]
    assert ids.index("groq") < ids.index("ollama")
    assert ids == sorted(ids, key=lambda i: CATALOG_PROVIDERS.index(i))
    # no overlay → catalog untouched
    assert merge_ollama_overlay(catalog, None) is catalog
