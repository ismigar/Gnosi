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
            "artificial_analysis_coding_index": intelligence + 1,
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


def test_build_payload_enriches_context_from_models_dev():
    row = _row(1, "Long Model", 25, 50, 1, 2)
    catalog = {"providers": [{"models": [{
        "id": "long-model",
        "name": "Long Model",
        "context_window": 1_000_000,
        "tags": ["long"],
        "release_date": "2026-07-01",
    }]}]}
    payload = aa.build_comparison_payload([row], catalog)
    model = payload["models"][0]
    assert model["context_window"] == 1_000_000
    assert model["profile"] == "expert"


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
    monkeypatch.setattr(aa, "load_catalog", lambda refresh: {"providers": []})
    result = aa.fetch_all_models()
    assert requested_pages == [1, 2]
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
