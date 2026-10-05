"""Budget estimates must not treat missing catalogue prices as free access."""
import pytest
from backend.agent import model_catalog


@pytest.mark.parametrize('price, expected', [
    ({}, None),
    ({'cost_in': 0, 'cost_out': 0}, None),
    ({'cost_in': 0, 'cost_out': 0, 'pricing_known': False}, None),
    ({'cost_in': 0, 'cost_out': 0, 'pricing_known': True}, {'cost_in': 0, 'cost_out': 0}),
    ({'cost_in': .95, 'cost_out': 4}, {'cost_in': .95, 'cost_out': 4}),
    ({'cost_in': .95, 'cost_out': 4, 'pricing_known': False}, None),
    ({'cost_in': .95}, None),
    ({'cost_in': True, 'cost_out': 4}, None),
    ({'cost_in': float('nan'), 'cost_out': 4}, None),
    ({'cost_in': .95, 'cost_out': float('inf')}, None),
])
def test_only_verified_prices_are_used(monkeypatch, price, expected):
    monkeypatch.setattr(model_catalog, 'catalog_provider', lambda _: {'models': [{'id': 'kimi', **price}]})
    assert model_catalog.catalog_model_cost('openrouter', 'kimi') == expected
    assert model_catalog.catalog_model_cost('openrouter', 'different-route') is None
