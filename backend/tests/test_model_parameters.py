from __future__ import annotations

import requests

from backend.services import model_parameters as service


def model(name, creator="Alibaba"):
    return {"name": name, "slug": name, "creator": creator}


def test_explicit_counts_and_unrelated_benchmarks():
    assert service.parse_card("Number of Parameters: 30.5B in total and 3.3B activated", "Qwen/a") == {"total": 30.5, "active": 3.3}
    assert service.parse_card("| **Total Parameters** | 1T |\n| **Activated Parameters** | 32B |", "moonshotai/a") == {"total": 1000, "active": 32}
    assert service.parse_card("| DeepSeek-R1 | 671B | 37B |", "deepseek-ai/DeepSeek-R1") == {"total": 671, "active": 37}
    assert service.parse_card("Other model has 70B parameters.\n| Other | 671B | 37B |", "Qwen/a") is None
    assert service.parse_card("Number of Parameters: 3B total and 30B activated", "Qwen/a") is None


def test_discovery_requires_exact_official_repository(monkeypatch):
    calls = []
    def get(url, **kwargs):
        calls.append(url)
        if url.endswith('/api/models'):
            return b'[{"id":"Other/Qwen3-8B"},{"id":"Qwen/Qwen3-8B-2507"},{"id":"Qwen/Qwen3-8B"}]'
        return b'Number of Parameters: 8.2B'
    monkeypatch.setattr(service, '_get', get)
    found = service.discover(model('Qwen3 8B (Reasoning)'), 'Qwen')
    assert found == {'total': 8.2, 'source': 'https://huggingface.co/Qwen/Qwen3-8B'}
    assert calls[-1] == 'https://huggingface.co/Qwen/Qwen3-8B/raw/main/README.md'
    monkeypatch.setattr(service, '_get', lambda *a, **kw: b'[{"id":"Qwen/Qwen3-8B"},{"id":"Qwen/Qwen3-8B-Instruct"}]')
    assert service.discover(model('Qwen3 8B'), 'Qwen') is None


def test_refresh_preserves_last_good_counts_on_failure_and_enriches_feed(tmp_path, monkeypatch):
    path = tmp_path / 'parameters.json'
    row = model('New official model')
    monkeypatch.setattr(service, 'discover', lambda *a: {'total': 45, 'active': 5, 'source': 'https://huggingface.co/Qwen/new'})
    assert service.refresh_parameters(models=[row], path=path)['verified'] == 1
    first = service.metadata(row, service.read_cache(path))
    def fail(*args):
        raise requests.Timeout()
    monkeypatch.setattr(service, 'discover', fail)
    assert service.refresh_parameters(models=[row], path=path)['source_errors'] == 1
    assert service.metadata(row, service.read_cache(path)) == first
    monkeypatch.setattr(service, 'cache_path', lambda: path)
    feed = {'models': [row]}
    assert service.enrich_comparison(feed)['models'][0]['parameter_metadata']['total'] == 45
    assert 'parameter_metadata' not in row


def test_batches_resume_and_unmatched_rows_stay_pending(tmp_path, monkeypatch):
    path = tmp_path / 'parameters.json'
    visited = []
    monkeypatch.setattr(service, 'discover', lambda row, author: visited.append(row['name']))
    models = [model('A'), model('B'), model('A (Reasoning)')]
    service.refresh_parameters(models=models, path=path, max_models=1)
    service.refresh_parameters(models=models, path=path, max_models=1)
    assert len(visited) == 2
    assert {service.base_name(name) for name in visited} == {'A', 'B'}
    assert service.metadata(model('A'), service.read_cache(path)) == {'status': 'pending'}
    assert service.metadata(model('GPT-6 Astra', 'OpenAI'), {})['status'] == 'not_published'
    assert service.metadata(model('Qwen3 32B'), {})['total'] == 32.8


def test_scheduler_reconciliation_does_not_duplicate_or_reenable(isolated_validation_runtime):
    from backend.scheduler.manager import SchedulerManager
    manager = SchedulerManager.__new__(SchedulerManager)
    manager._tasks = {}
    manager._reconcile_available_tasks()
    task = manager._tasks['refresh_model_parameters']
    assert task.enabled and task.interval_minutes == 1440
    task.enabled = False
    manager._reconcile_available_tasks()
    assert manager._tasks['refresh_model_parameters'] is task
    assert not task.enabled
