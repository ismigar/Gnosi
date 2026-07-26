"""Pure transformation and paginated-fetch tests for Artificial Analysis."""

from backend.services import artificial_analysis as aa


def _row(index, name, intelligence, speed, input_price, output_price):
    return {
        "id": f"id-{index}",
        "slug": name.lower().replace(" ", "-"),
        "name": name,
        "release_date": f"2026-07-{index:02d}",
        "model_creator": {"name": "Frontier Lab"},
        "evaluations": {
            "artificial_analysis_intelligence_index": intelligence,
            "artificial_analysis_coding_index": (
                intelligence + 1 if intelligence is not None else None
            ),
        },
        "pricing": {
            "price_1m_input_tokens": input_price,
            "price_1m_output_tokens": output_price,
        },
        "performance": {
            "median_output_tokens_per_second": speed,
            "median_time_to_first_token_seconds": 0.5,
        },
    }


def test_build_payload_includes_every_row_and_assigns_frontier_profile():
    rows = [
        _row(1, "Cheap Mini", 10, 200, 0.02, 0.05),
        _row(2, "Balanced", 30, 80, 1, 3),
        _row(3, "Frontier Reasoning (max)", 60, 40, 3, 15),
    ]
    payload = aa.build_comparison_payload(rows, intelligence_index_version=4.1)
    assert payload["count"] == 3
    assert {model["name"] for model in payload["models"]} == {
        "Cheap Mini", "Balanced", "Frontier Reasoning (max)",
    }
    frontier = next(model for model in payload["models"] if model["name"].startswith("Frontier"))
    cheap = next(model for model in payload["models"] if model["name"] == "Cheap Mini")
    assert frontier["profile"] == "expert"
    assert cheap["profile"] == "worker"
    assert payload["intelligence_index_version"] == 4.1


def test_profile_intervals_cut_off_models_above_and_below():
    rows = [
        _row(index, f"Model {index}", index * 10, 50, 1, 2)
        for index in range(1, 11)
    ]

    payload = aa.build_comparison_payload(rows)
    names_by_profile = {
        profile: {
            model["name"]
            for model in payload["models"]
            if model["profile"] == profile
        }
        for profile in (
            "worker",
            "administrative",
            "documentalist",
            "allrounder",
            "expert",
        )
    }

    assert names_by_profile == {
        "worker": {"Model 1", "Model 2"},
        "administrative": {"Model 3", "Model 4"},
        "documentalist": {"Model 5", "Model 6"},
        "allrounder": {"Model 7", "Model 8"},
        "expert": {"Model 9", "Model 10"},
    }


def test_unbenchmarked_model_does_not_leak_into_middle_profile():
    rows = [
        _row(1, "Low", 10, 10, 0.01, 0.01),
        _row(2, "Unknown Fast Long", None, 500, 0.01, 0.01),
        _row(3, "High", 90, 10, 10, 10),
    ]

    payload = aa.build_comparison_payload(rows)
    unknown = next(
        model for model in payload["models"] if model["name"] == "Unknown Fast Long"
    )

    assert unknown["profile"] == "unrated"


def test_build_payload_enriches_context_from_models_dev():
    row = _row(1, "Long Model", 25, 50, 1, 2)
    catalog = {"providers": [{
        "id": "cloud-host",
        "name": "Cloud Host",
        "is_local": False,
        "models": [{
        "id": "long-model",
        "name": "Long Model",
        "cost_in": 1,
        "cost_out": 2,
        "context_window": 1_000_000,
        "tags": ["long"],
        "quality": 3,
        "release_date": "2026-07-01",
    }]}]}
    payload = aa.build_comparison_payload([row], catalog)
    model = payload["models"][0]
    assert model["context_window"] == 1_000_000
    assert model["profile"] == "expert"
    assert model["routes"] == [{
        "provider": "cloud-host",
        "provider_name": "Cloud Host",
        "model_id": "long-model",
        "model_name": "Long Model",
        "is_local": False,
        "cost_in": 1.0,
        "cost_out": 2.0,
        "context_window": 1_000_000,
        "quality": 3,
        "tags": ["long"],
    }]


def test_fetch_all_models_follows_every_page(monkeypatch):
    monkeypatch.setenv("ARTIFICIAL_ANALYSIS_API_KEY", "test-key")
    pages = {
        1: {"data": [_row(1, "One", 10, 10, 1, 1)],
            "pagination": {"has_more": True, "total_pages": 2},
            "intelligence_index_version": 4.1},
        2: {"data": [_row(2, "Two", 20, 20, 2, 2)],
            "pagination": {"has_more": False, "total_pages": 2},
            "intelligence_index_version": 4.1},
    }

    class Response:
        status_code = 200
        ok = True

        def __init__(self, payload):
            self.payload = payload

        def json(self):
            return self.payload

    requested_pages = []

    def fake_get(_self, _url, *, headers, params, timeout):
        assert headers == {"x-api-key": "test-key"}
        assert timeout == aa._TIMEOUT_SECONDS
        requested_pages.append(params["page"])
        return Response(pages[params["page"]])

    monkeypatch.setattr(aa.requests.Session, "get", fake_get)
    refresh_requests = []

    def fake_load_catalog(force_refresh=False):
        refresh_requests.append(force_refresh)
        return {"providers": []}

    monkeypatch.setattr(aa, "load_catalog", fake_load_catalog)
    result = aa.fetch_all_models()
    assert requested_pages == [1, 2]
    assert refresh_requests == [True]
    assert result["count"] == 2


def test_fetch_requires_server_side_key(monkeypatch):
    monkeypatch.delenv("ARTIFICIAL_ANALYSIS_API_KEY", raising=False)
    monkeypatch.delenv("AA_API_KEY", raising=False)
    monkeypatch.setattr(
        "backend.security.ai_credentials.resolve_provider_api_key",
        lambda *_args, **_kwargs: None,
    )
    try:
        aa.fetch_all_models()
    except aa.ArtificialAnalysisError as exc:
        assert exc.code == "api_key_missing"
    else:
        raise AssertionError("Missing key must not silently return stale sample data")


def test_rate_limit_falls_back_to_models_dev_catalog(monkeypatch):
    monkeypatch.setenv("ARTIFICIAL_ANALYSIS_API_KEY", "test-key")
    monkeypatch.setattr(aa, "_read_cache", lambda: None)

    class Response:
        status_code = 429
        ok = False

    monkeypatch.setattr(aa.requests.Session, "get", lambda *_args, **_kwargs: Response())
    monkeypatch.setattr(aa, "load_catalog", lambda force_refresh=False: {
        "providers": [{
            "id": "openai",
            "name": "OpenAI",
            "is_local": False,
            "models": [{
                "id": "fallback-model",
                "name": "Fallback Model",
                "cost_in": 1,
                "cost_out": 2,
                "context_window": 128_000,
                "quality": 2,
                "tags": ["long"],
                "release_date": "2026-07-01",
            }],
        }],
    })

    result = aa.fetch_all_models()

    assert result["fallback"] is True
    assert result["fallback_reason"] == "rate_limited"
    assert result["source"] == "models.dev"
    assert result["count"] == 1
    assert result["models"][0]["name"] == "Fallback Model"


def test_rate_limit_prefers_last_successful_cache(monkeypatch):
    monkeypatch.setenv("ARTIFICIAL_ANALYSIS_API_KEY", "test-key")
    cached = {"source": "Artificial Analysis", "count": 1, "models": [{"id": "cached"}]}
    monkeypatch.setattr(aa, "_read_cache", lambda: cached)

    class Response:
        status_code = 429
        ok = False

    monkeypatch.setattr(aa.requests.Session, "get", lambda *_args, **_kwargs: Response())
    result = aa.fetch_all_models()

    assert result["models"] == [{"id": "cached"}]
    assert result["fallback"] is True
    assert result["stale"] is True
