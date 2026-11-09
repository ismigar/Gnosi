"""Monthly statistics parsing, isolation and bounded public transport."""
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from backend.domains.sites.models import SiteConfig
from backend.domains.sites.public_http import PublicFetchError, PublicResponse
from backend.domains.sites.statistics import parse_report, read_statistics


def report(volume='588,59 MB', visits='2795'):
    values = ['month', '1916', '1376', '590', '310', '3106', volume, visits, '5317', '12390', '17248']
    return ('<meta name="DC.date.modified" content="09-nov-2026 00:36 CET"><table><tr>' + ''.join('<td>' + ('<a href="usage_202611.html">nov 2026</a>' if i == 0 else value) + '</td>' for i, value in enumerate(values)) + '</tr></table>').encode()


def test_awffull_monthly_columns_and_decimal_comma():
    value = parse_report(report(), 'https://example.org/webalizer/')
    month = value.months[0]
    assert (month.month, month.visits, month.pages, month.hits, month.clients, month.files) == ('2026-11', 2795, 5317, 17248, 3106, 12390)
    assert month.transfer_bytes == round(588.59 * 1024 ** 2)
    assert value.generated_at == '09-nov-2026 00:36 CET'


def test_webalizer_raw_kib_and_zero_are_not_missing_data():
    value = parse_report(report('1,024', '0'), 'https://example.org')
    assert value.months[0].transfer_bytes == 1024 ** 2
    assert value.months[0].visits == 0


@pytest.mark.parametrize('body', [b'<html>Login</html>', report(visits='bad')])
def test_unreadable_reports_are_not_zero_statistics(body):
    with pytest.raises(HTTPException) as error:
        parse_report(body, 'https://example.org')
    assert error.value.status_code == 422


def test_site_source_and_default_origin_are_isolated():
    with patch('backend.domains.sites.statistics.fetch', return_value=PublicResponse('https://example.org/webalizer/', report(), 'text/html')) as fetch:
        read_statistics(SiteConfig(name='First', origin='https://first.example.org/ca'))
        assert fetch.call_args.args[0] == 'https://first.example.org/webalizer/'
        read_statistics(SiteConfig(name='Second', statistics_url='https://second.example.org/stats/'))
        assert fetch.call_args.args[0] == 'https://second.example.org/stats/'
        assert fetch.call_args.kwargs['maximum'] == 1024 * 1024
        fetch.side_effect = PublicFetchError('Private address')
        with pytest.raises(HTTPException) as error:
            read_statistics(SiteConfig(name='Private', origin='http://127.0.0.1'))
        assert error.value.status_code == 502


def test_route_requires_editor_and_never_caches(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.domains.sites import api
    from backend.domains.sites.storage import SiteStore
    from backend.services.workspace_service import WorkspaceContext, get_workspace_context

    vault = tmp_path / 'vault'
    vault.mkdir()
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path / 'device'))
    context = WorkspaceContext('workspace', 'owner', 'owner', vault)
    store = SiteStore(context)
    site = store.save(SiteConfig(name='Statistics', statistics_url='https://example.org/stats/'), create=True)
    assert store.load(site.id).statistics_url == 'https://example.org/stats/'
    app = FastAPI()
    app.include_router(api.router, prefix='/api/vault')
    app.dependency_overrides[get_workspace_context] = lambda: context
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    monkeypatch.setattr(api, 'store_for', lambda ctx: store)
    with patch('backend.domains.sites.statistics.fetch', return_value=PublicResponse('https://example.org/stats/', report(), 'text/html')) as fetch:
        with TestClient(app) as client:
            response = client.get('/api/vault/sites/' + site.id + '/statistics')
            assert response.status_code == 200
            assert response.headers['cache-control'] == 'no-store'
            assert response.json()['months'][0]['visits'] == 2795
            context.role = 'viewer'
            assert client.get('/api/vault/sites/' + site.id + '/statistics').status_code == 403
            assert fetch.call_count == 1
