from __future__ import annotations

import pytest
import requests
from pydantic import ValidationError

from backend.services import model_parameter_review as review
from backend.services import model_parameters as parameters


@pytest.fixture
def model(tmp_path, monkeypatch):
    monkeypatch.setattr(parameters, 'cache_path', lambda: tmp_path / 'parameters.json')
    return {'id': 'exact-version', 'name': 'Qwen Future 7', 'creator': 'Alibaba'}


def request(**kwargs):
    return review.ParameterReviewRequest(model_id='exact-version', **kwargs)


def test_manual_review_requires_evidence_and_valid_counts(model):
    for kwargs in [dict(reviewed=False, source='https://example.com'),
                   dict(reviewed=True, source='http://example.com'),
                   dict(reviewed=True, source='https://user:pass@example.com'),
                   dict(reviewed=True, source='https://example.com', active=11)]:
        with pytest.raises(ValueError):
            review.review(request(action='save', total=10, **kwargs), model=model)
    assert parameters.read_cache()['entries'] == {}
    with pytest.raises(ValidationError):
        request(action='save', total=float('nan'))


def test_reviewed_count_persists_without_fetching_supplied_url(model, monkeypatch):
    monkeypatch.setattr(parameters, '_get', lambda *a, **kw: pytest.fail('Unexpected request'))
    result = review.review(request(action='save', total=12, active=2, source='https://example.com/model-7', reviewed=True), model=model)
    assert (result['status'], result['total'], result['verification']) == ('known', 12, 'user_review')
    assert review.review(request(), model=model)['total'] == 12


def test_discovery_does_not_infer_nonpublication_and_preserves_review(model, monkeypatch):
    monkeypatch.setattr(parameters, 'discover', lambda *a: None)
    assert review.review(request(action='refresh'), model=model)['status'] == 'pending'
    review.review(request(action='save', status='not_published', reviewed=True, source='https://example.com/spec'), model=model)
    result = review.review(request(action='refresh'), model=model)
    assert (result['status'], result['outcome']) == ('not_published', 'needs_review')
    def unavailable(*args):
        raise requests.Timeout()
    monkeypatch.setattr(parameters, 'discover', unavailable)
    result = review.review(request(action='refresh'), model=model)
    assert (result['status'], result['outcome']) == ('not_published', 'source_unavailable')


def test_official_refresh_persists_exact_version(model, monkeypatch):
    monkeypatch.setattr(parameters, 'discover', lambda m, author: {'total': 15, 'source': 'https://huggingface.co/Qwen/model-7'})
    result = review.review(request(action='refresh'), model=model)
    assert (result['total'], result['verification'], result['outcome']) == (15, 'official_card', 'verified')
    with pytest.raises(LookupError):
        review.review(review.ParameterReviewRequest(model_id='other-version'), model=model)


def test_stale_batch_cannot_replace_later_manual_review(model):
    key = parameters.model_key(model)
    parameters.write_cache({'entries': {key: {'total': 12, 'checked_at': '2026-09-26T12:00:00+00:00'}}})
    parameters.write_cache({'entries': {key: {'total': 10, 'checked_at': '2026-09-26T11:00:00+00:00'}, 'other': {'total': 5}}})
    cache = parameters.read_cache()['entries']
    assert cache[key]['total'] == 12
    assert cache['other']['total'] == 5
