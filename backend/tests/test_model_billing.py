"""Provider-plan evidence must never become a zero-priced inference tariff."""
from datetime import date

import pytest

from backend.services import artificial_analysis as aa, model_billing as billing

TODAY = date(2026, 10, 4)


@pytest.fixture(autouse=True)
def offline_fx(monkeypatch):
    monkeypatch.setattr("backend.services.fx_rates.rate_info", lambda code: {
        "code": code, "symbol": code, "usd_rate": 1, "source": "static", "fetched_at": "",
    })


def route(provider_id, model_id="test", **values):
    return billing.route_billing(
        {"id": provider_id, "doc": "https://example.test/pricing"},
        {"id": model_id, "cost_in": 0, "cost_out": 0, "pricing_known": True, **values},
        today=TODAY,
    )


def test_alibaba_credits_are_not_free_tokens_or_kimi_coverage():
    result = route("alibaba-token-plan", "kimi-k2.6")
    assert result["kind"] == "subscription"
    assert result["model_covered"] is False
    assert result["plans"][0]["monthly_fee_usd"] == 8
    assert result["plans"][0]["quota"] == 11500
    assert result["plans"][0]["quota_unit"] == "credits"
    assert result["plans"][0]["input_units_per_million"] is None
    assert result["checked_at"] == "2026-10-04"
    assert not result["stale"]


def test_exact_model_allowances_are_independent_from_raw_tariffs():
    kimi = route("opencode-go", "kimi-k2.6", cost_in=.95, cost_out=4)
    newer = route("opencode-go", "kimi-k3")
    assert [p["quota"] for p in kimi["plans"]] == [60, 240]
    assert [p["quota"] for p in newer["plans"]] == [15, 60]
    assert kimi["plans"][0]["input_units_per_million"] == .95
    assert kimi["plans"][0]["output_units_per_million"] == 4
    assert kimi["input_price_usd"] is None  # no inference accounting override


def test_context_tiered_or_unlisted_models_do_not_borrow_other_rates():
    for model_id in ("gpt-6-luna", "kimi-unknown", "deepseek-v4-pro"):
        result = route("opencode-go", model_id, cost_in=.1, cost_out=.5)
        assert all(p["input_units_per_million"] is None for p in result["plans"])


def test_regional_plan_prices_are_not_converted_one_to_one():
    result = route("alibaba-token-plan-cn")
    assert result["plans"][0]["currency"] == "CNY"
    assert result["plans"][0]["monthly_fee"] == 60
    assert result["plans"][0]["monthly_fee_usd"] is None
    assert route("minimax-coding-plan")["plans"][0]["monthly_fee"] == 22
    assert route("minimax-cn-coding-plan")["plans"][0]["monthly_fee"] == 49


def test_weekly_allowance_is_not_invented_as_monthly():
    result = route("zai-coding-plan", "glm-5.3")
    assert result["plans"][0]["quota_period"] == "week"
    assert result["plans"][0]["quota"] == 10000
    assert result["plans"][1]["monthly_fee"] is None


def test_foreign_plan_fee_uses_verified_fx(monkeypatch):
    monkeypatch.setattr("backend.services.fx_rates.rate_info", lambda code: {
        "code": code, "symbol": code, "usd_rate": 7, "source": "frankfurter.app", "fetched_at": "2026-10-04",
    })
    result = route("tencent-token-plan", "hy3")
    assert result["plans"][0]["monthly_fee_usd"] == 4
    assert result["plans"][0]["input_units_per_million"] == 16
    assert result["plans"][1]["input_units_per_million"] == 15.6


@pytest.mark.parametrize("rate", [0, -1, float("nan"), float("inf")])
def test_invalid_foreign_quote_cannot_create_free_or_invalid_plan_prices(monkeypatch, rate):
    monkeypatch.setattr("backend.services.fx_rates.rate_info", lambda code: {
        "code": code, "symbol": code, "usd_rate": rate, "source": "frankfurter.app", "fetched_at": "2026-10-04",
    })
    assert route("alibaba-token-plan-cn")["plans"][0]["monthly_fee_usd"] is None


@pytest.mark.parametrize("provider_id", ["new-host", "kenari", "nvidia"])
def test_unverified_remote_zero_is_explicitly_unknown(provider_id):
    assert route(provider_id)["kind"] == "unknown"


def test_unreviewed_plan_remains_visible_without_invented_fee():
    result = route("new-coding-plan")
    assert result["kind"] == "subscription"
    assert result["source_url"] == "https://example.test/pricing"
    assert result["plans"] == []
    assert result["checked_at"] is None


def test_free_endpoint_is_not_confused_with_paid_model_on_same_host():
    assert route("openrouter", "example:free")["kind"] == "free"
    assert route("openrouter", "example")["kind"] == "unknown"
    paid = route("openrouter", "example", cost_in=1, cost_out=4)
    assert paid["kind"] == "metered"
    assert paid["input_price_usd"] == 1


def test_retired_subscription_is_not_assumed_from_provider_name():
    result = route("umans-ai-coding-plan", "umans-glm-5.3-flash")
    assert result["kind"] == "metered"
    assert result["input_price_usd"] == .15
    assert result["output_price_usd"] == .5
    assert result["plans"] == []


def test_stale_or_future_evidence_is_flagged():
    for day in (date(2026, 11, 5), date(2026, 9, 1)):
        result = billing.route_billing({"id": "opencode-go"}, {"id": "kimi-k2.6"}, today=day)
        assert result["stale"]
        assert result["checked_at"] == "2026-10-04"


def test_local_route_has_no_subscription():
    assert billing.route_billing({"id": "local", "is_local": True}, {})["kind"] == "local"


@pytest.mark.parametrize("values", [
    {"pricing_known": False, "cost_in": 1, "cost_out": 4},
    {"pricing_known": None, "cost_in": 0, "cost_out": 4},
    {"cost_in": float("nan"), "cost_out": 4},
    {"cost_in": -1, "cost_out": 4},
])
def test_invalid_and_legacy_prices_do_not_get_restored_as_known(values):
    assert route("test", **values)["kind"] == "unknown"


def test_cached_comparison_receives_billing_without_changing_catalog():
    model = {"id": "kimi-k2.6", "name": "Kimi K2.6", "cost_in": 0,
             "cost_out": 0, "pricing_known": True, "context_window": 200000}
    catalog = {"providers": [{"id": "alibaba-token-plan", "models": [model]}]}
    cached = {"models": [{"id": "kimi-k2.6", "name": "Kimi K2.6", "routes": []}]}
    updated = aa._enrich_cached_payload(cached, catalog)["models"][0]["routes"][0]
    assert updated["billing"]["kind"] == "subscription"
    assert updated["cost_in"] == model["cost_in"] == 0
    assert updated["cost_out"] == model["cost_out"] == 0


def test_all_reviewed_plans_validate_and_include_public_evidence():
    for provider_id, evidence in billing.load_billing_evidence().items():
        result = route(provider_id)
        billing.ComparisonBilling.model_validate(result)
        assert result["source_url"].startswith("https://")
        assert result["checked_at"] == evidence["checked_at"]
