"""Pure transformation and paginated-fetch tests for Artificial Analysis."""

from datetime import datetime, timedelta, timezone

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


def test_number_rejects_non_finite_and_negative_sentinels():
    """NaN/Infinity/negatives must fall back to models.dev, not render as $NaN."""
    assert aa._number(float("nan")) is None
    assert aa._number(float("inf")) is None
    assert aa._number(float("-inf")) is None
    assert aa._number(-5) is None
    assert aa._number("-0.1") is None
    # Legitimate values pass through, including a genuinely free model.
    assert aa._number(0) == 0.0
    assert aa._number("1.5") == 1.5
    assert aa._number(None) is None
    assert aa._number("not-a-number") is None


def test_build_payload_prefers_creator_matched_catalog_entry():
    """Enrichment must pick the canonical host, not a reseller with more context."""
    row = {
        "id": "claude-id",
        "slug": "claude-3-5-sonnet",
        "name": "Claude 3.5 Sonnet",
        "model_creator": {"name": "Anthropic"},
        "evaluations": {"artificial_analysis_intelligence_index": 50},
    }
    catalog = {"providers": [
        {
            "id": "digitalocean",
            "name": "DigitalOcean",
            "is_local": False,
            "models": [{
                "id": "anthropic-claude-3-5-sonnet",
                "name": "Claude 3.5 Sonnet",
                "context_window": 2_000_000,  # larger — would win on context alone
                "cost_in": 5,
                "cost_out": 25,
            }],
        },
        {
            "id": "anthropic",
            "name": "Anthropic",
            "is_local": False,
            "models": [{
                "id": "claude-3-5-sonnet",
                "name": "Claude 3.5 Sonnet",
                "context_window": 200_000,
                "cost_in": 3,
                "cost_out": 15,
            }],
        },
    ]}
    model = aa.build_comparison_payload([row], catalog)["models"][0]
    # Anthropic wins over DigitalOcean despite the smaller window.
    assert model["context_window"] == 200_000
    assert model["input_price"] == 3
    assert model["output_price"] == 15
    assert any(r["provider"] == "anthropic" for r in model["routes"])


def test_build_payload_falls_back_to_max_context_when_creator_unknown():
    """When no provider matches the creator, the legacy max-context rule applies."""
    row = {
        "id": "mystery-id",
        "slug": "mystery-model",
        "name": "Mystery Model",
        "model_creator": {"name": "Unknown Labs"},
        "evaluations": {"artificial_analysis_intelligence_index": 50},
    }
    catalog = {"providers": [
        {
            "id": "host-a",
            "name": "Host A",
            "is_local": False,
            "models": [{
                "id": "mystery-model",
                "name": "Mystery Model",
                "context_window": 100_000,
            }],
        },
        {
            "id": "host-b",
            "name": "Host B",
            "is_local": False,
            "models": [{
                "id": "mystery-model",
                "name": "Mystery Model",
                "context_window": 300_000,
            }],
        },
    ]}
    model = aa.build_comparison_payload([row], catalog)["models"][0]
    assert model["context_window"] == 300_000


def test_build_payload_no_longer_emits_end_to_end():
    """end_to_end is computed but never displayed; drop it from the payload."""
    row = _row(1, "Any Model", 25, 50, 1, 2)
    model = aa.build_comparison_payload([row])["models"][0]
    assert "end_to_end" not in model


def test_build_payload_deduplicates_same_model_across_rows():
    """Pagination overlap or upstream id/slug variation must not duplicate a model."""
    first = _row(1, "Twin Model", 30, 80, None, None)
    first["context_window_tokens"] = 200_000
    second = _row(1, "Twin Model", 30, 80, 1, 3)
    second["context_window_tokens"] = None

    payload = aa.build_comparison_payload([first, second])

    assert payload["count"] == 1
    assert len(payload["models"]) == 1
    model = payload["models"][0]
    # First occurrence wins; later rows do not override populated fields.
    assert model["id"] == "id-1"
    assert model["name"] == "Twin Model"
    assert model["context_window"] == 200_000
    assert model["input_price"] is None  # not backfilled from the duplicate row


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
        "modes": ["text", "image"],
        "quality": 3,
        "release_date": "2026-07-01",
    }]}]}
    payload = aa.build_comparison_payload([row], catalog)
    model = payload["models"][0]
    assert model["context_window"] == 1_000_000
    assert model["metric_sources"]["context_window"] == "models_dev"
    assert model["profile"] == "expert"
    assert model["modes"] == ["image", "text"]
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


def test_build_payload_enriches_missing_prices_from_models_dev():
    row = _row(1, "Catalog Priced", 25, 50, None, None)
    catalog = {"providers": [{
        "id": "cloud-host",
        "name": "Cloud Host",
        "is_local": False,
        "models": [{
            "id": "catalog-priced",
            "name": "Catalog Priced",
            "cost_in": 0.8,
            "cost_out": 4,
            "context_window": 200_000,
        }],
    }]}

    model = aa.build_comparison_payload([row], catalog)["models"][0]

    assert model["input_price"] == 0.8
    assert model["output_price"] == 4
    assert model["metric_sources"]["input_price"] == "models_dev"
    assert model["metric_sources"]["output_price"] == "models_dev"


def test_refresh_preserves_missing_metrics_from_last_cache():
    previous = {
        "models": [{
            "id": "stable-id",
            "slug": "stable-model",
            "name": "Stable Model",
            "speed": 88,
            "latency": 0.4,
            "coding": 42,
        }],
    }
    current = {
        "models": [{
            "id": "stable-id",
            "slug": "stable-model",
            "name": "Stable Model",
            "speed": None,
            "latency": None,
            "coding": None,
        }],
    }

    result = aa._merge_cached_metrics(current, previous)

    assert result["models"][0]["speed"] == 88
    assert result["models"][0]["latency"] == 0.4
    assert result["models"][0]["coding"] == 42
    assert result["models"][0]["metric_sources"] == {
        "speed": "artificial_analysis_cache",
        "latency": "artificial_analysis_cache",
        "coding": "artificial_analysis_cache",
    }


def test_refresh_does_not_replace_current_metrics_with_cache():
    previous = {
        "models": [{
            "id": "stable-id",
            "name": "Stable Model",
            "speed": 50,
        }],
    }
    current = {
        "models": [{
            "id": "stable-id",
            "name": "Stable Model",
            "speed": 90,
        }],
    }

    result = aa._merge_cached_metrics(current, previous)

    assert result["models"][0]["speed"] == 90
    assert "metric_sources" not in result["models"][0]


def test_fetch_all_models_follows_every_page(monkeypatch):
    monkeypatch.setenv("ARTIFICIAL_ANALYSIS_API_KEY", "test-key")
    monkeypatch.setattr(aa, "_read_cache", lambda: None)
    written = []
    monkeypatch.setattr(aa, "_write_cache", written.append)
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
    assert written == [result]


def test_fetch_requires_server_side_key(monkeypatch):
    monkeypatch.delenv("ARTIFICIAL_ANALYSIS_API_KEY", raising=False)
    monkeypatch.delenv("AA_API_KEY", raising=False)
    monkeypatch.setattr(
        "backend.security.ai_credentials.resolve_provider_api_key",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(aa, "_read_cache", lambda: None)
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
        headers = {"X-Ratelimit-Reset": "1785107576"}

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
    assert result["retry_at"] == "2026-07-26T23:12:56+00:00"


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


def test_fresh_cache_avoids_repeated_upstream_requests(monkeypatch):
    cached = {
        "source": "Artificial Analysis",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "count": 1,
        "models": [{"id": "cached"}],
    }
    monkeypatch.setattr(aa, "_read_cache", lambda: cached)
    monkeypatch.setattr(
        aa.requests.Session,
        "get",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("Fresh cache must avoid an upstream request")
        ),
    )

    assert aa.fetch_all_models() == cached


def test_expired_cache_is_refreshed_when_upstream_is_available(monkeypatch):
    monkeypatch.setenv("ARTIFICIAL_ANALYSIS_API_KEY", "test-key")
    cached = {
        "source": "Artificial Analysis",
        "fetched_at": (
            datetime.now(timezone.utc) - timedelta(days=2)
        ).isoformat(),
        "count": 1,
        "models": [{"id": "old"}],
    }
    monkeypatch.setattr(aa, "_read_cache", lambda: cached)

    class Response:
        status_code = 200
        ok = True

        @staticmethod
        def json():
            return {
                "data": [_row(1, "Fresh", 10, 10, 1, 1)],
                "pagination": {"has_more": False, "total_pages": 1},
            }

    monkeypatch.setattr(
        aa.requests.Session,
        "get",
        lambda *_args, **_kwargs: Response(),
    )
    monkeypatch.setattr(aa, "load_catalog", lambda force_refresh=False: {
        "providers": [],
    })
    written = []
    monkeypatch.setattr(aa, "_write_cache", written.append)

    result = aa.fetch_all_models()

    assert result["models"][0]["name"] == "Fresh"
    assert written == [result]


def test_missing_key_prefers_last_successful_cache(monkeypatch):
    monkeypatch.delenv("ARTIFICIAL_ANALYSIS_API_KEY", raising=False)
    monkeypatch.delenv("AA_API_KEY", raising=False)
    monkeypatch.setattr(
        "backend.security.ai_credentials.resolve_provider_api_key",
        lambda *_args, **_kwargs: None,
    )
    cached = {
        "source": "Artificial Analysis",
        "fetched_at": "2026-07-01T00:00:00+00:00",
        "count": 1,
        "models": [{"id": "cached"}],
    }
    monkeypatch.setattr(aa, "_read_cache", lambda: cached)

    result = aa.fetch_all_models()

    assert result["models"] == [{"id": "cached"}]
    assert result["fallback"] is True
    assert result["fallback_reason"] == "api_key_missing"
    assert result["stale"] is True
