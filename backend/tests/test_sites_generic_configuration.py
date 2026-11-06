"""Generic website connections keep credentials local and contact captions editable."""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.domains.sites import connection_credentials, runtime
from backend.domains.sites.models import SiteConfig, SiteForm, TargetConnection, TargetConnectionSecret
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext


@pytest.fixture
def configured(tmp_path, monkeypatch):
    vault = tmp_path / 'vault'
    vault.mkdir()
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path / 'device'))
    store = SiteStore(WorkspaceContext('workspace', 'owner', 'owner', vault))
    site = store.save(SiteConfig(name='Independent website'), create=True)
    settings = TargetConnection(host='hosting.example.org', username='publisher', authentication='password')
    credentials = {}
    import keyring
    monkeypatch.setattr(keyring, 'get_password', lambda service, key: credentials.get((service, key)))
    monkeypatch.setattr(keyring, 'set_password', lambda service, key, value: credentials.__setitem__((service, key), value))
    monkeypatch.setattr(keyring, 'delete_password', lambda service, key: credentials.pop((service, key)))
    runtime.save_connection(store, site.id, 'local', settings)
    return SimpleNamespace(store=store, site=site, settings=settings, credentials=credentials)


def test_password_is_not_returned_or_written_to_vault_or_connection_file(configured):
    value = configured
    connection_credentials.save_secret(value.store, value.site.id, 'local', TargetConnectionSecret(password='not-a-real-password'))
    settings = runtime.connection(value.store, value.site.id, 'local')
    assert settings.password_configured and settings._password == 'not-a-real-password'
    assert 'not-a-real-password' not in settings.model_dump_json()
    assert '_password' not in repr(settings)
    assert value.credentials and set(value.credentials.values()) == {'not-a-real-password'}
    for path in [*value.store.vault.rglob('*.json'), *value.store.private_root.rglob('*.json')]:
        assert 'not-a-real-password' not in path.read_text()


def test_credentials_are_bound_to_remote_account_and_can_be_removed(configured):
    value = configured
    connection_credentials.save_secret(value.store, value.site.id, 'local', TargetConnectionSecret(password='example-secret'))
    changed = value.settings.model_copy(update={'host': 'different.example.org', 'password_configured': True})
    saved = runtime.save_connection(value.store, value.site.id, 'local', changed)
    assert not saved.password_configured and saved._password is None
    runtime.save_connection(value.store, value.site.id, 'local', value.settings)
    connection_credentials.save_secret(value.store, value.site.id, 'local', TargetConnectionSecret(clear=True))
    assert not runtime.connection(value.store, value.site.id, 'local').password_configured
    assert not value.credentials


def test_credential_store_failure_is_explicit_and_never_serializes_the_secret(configured, monkeypatch):
    import keyring
    monkeypatch.setattr(keyring, 'set_password', lambda *args: (_ for _ in ()).throw(RuntimeError('example-secret')))
    with pytest.raises(HTTPException) as failure:
        connection_credentials.save_secret(configured.store, configured.site.id, 'local', TargetConnectionSecret(password='example-secret'))
    assert failure.value.status_code == 503
    assert 'example-secret' not in str(failure.value)


def test_password_is_forwarded_only_to_the_owned_transport(configured, monkeypatch):
    from backend.domains.sites import ssh_transport
    connection_credentials.save_secret(configured.store, configured.site.id, 'local', TargetConnectionSecret(password='example-secret'))
    settings = runtime.connection(configured.store, configured.site.id, 'local')
    settings.remote_root = '/srv/public/_gnosi-example'
    observed = []
    monkeypatch.setattr(ssh_transport, 'run_ssh', lambda *args: observed.append(args) or b'ok')
    assert runtime._ssh(settings, 'true') == b'ok'
    assert observed[0][-1] == 'example-secret'
    assert 'example-secret' not in json.dumps(settings.model_dump())


def test_contact_texts_round_trip_without_mandating_a_brand_or_language():
    original = SiteForm(name='Support', title={'fr': 'Aide'}, privacy_label={'fr': 'Je consens'},
                        newsletter_label={'fr': 'Recevoir les nouvelles'}, required_message={'fr': 'À compléter'},
                        failure_message={'fr': 'Réessayez'})
    assert SiteForm.model_validate_json(original.model_dump_json()) == original
    assert SiteForm.model_validate({'name': 'Legacy'}).privacy_label == {}


def test_generic_theme_is_neutral_and_explicit_existing_theme_name_is_preserved():
    assert SiteConfig(name='Another website').theme.name == 'Default'
    assert SiteConfig.model_validate({'name': 'Existing', 'theme': {'name': 'Temenos'}}).theme.name == 'Temenos'


def test_sftp_connection_success_is_distinct_from_missing_publication_runtime(configured, monkeypatch):
    from backend.domains.sites import ssh_transport
    settings = configured.settings.model_copy(update={'transfer_protocol': 'sftp'})
    runtime.save_connection(configured.store, configured.site.id, 'local', settings)
    configured.site.targets[0].adapter = 'ssh'
    monkeypatch.setattr(ssh_transport, 'probe_sftp', lambda *args, **kwargs: True)
    monkeypatch.setattr(runtime, '_ssh', lambda *args, **kwargs: (_ for _ in ()).throw(HTTPException(503, 'No shell')))
    status = runtime.probe(configured.store, configured.site, 'local')
    assert status.reachable
    assert status.detail == 'sftp_ready_shell_unavailable'


def test_import_preview_route_precedes_dynamic_site_routes_and_requires_admin(configured, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.domains.sites import api, url_import, web_import_routes
    from backend.services.workspace_service import get_workspace_context
    app = FastAPI()
    app.include_router(api.router, prefix='/api/vault')
    app.dependency_overrides[get_workspace_context] = lambda: configured.store.context
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    app.dependency_overrides[web_import_routes.router.dependencies[0].dependency] = lambda: None
    monkeypatch.setattr(api, 'store_for', lambda context: configured.store)
    calls = []
    response = {'id': 'preview', 'url': 'https://example.org/', 'name': 'Example', 'pages': [{'id': 'home', 'title': 'Home', 'path': '/', 'language': 'en'}], 'warnings': [], 'expires_at': '2099-01-01T00:00:00Z', 'assets_count': 0}
    monkeypatch.setattr(url_import, 'preview', lambda store, url, maximum: calls.append((url, maximum)) or response)
    with TestClient(app) as client:
        result = client.post('/api/vault/sites/import/preview', json={'url': 'https://example.org/'})
        assert result.status_code == 200 and result.json()['id'] == 'preview'
        assert calls == [('https://example.org/', 20)]
        configured.store.context.role = 'viewer'
        assert client.post('/api/vault/sites/import/preview', json={'url': 'https://example.org/'}).status_code == 403
        assert len(calls) == 1


def test_password_route_never_returns_the_secret_and_prevents_response_caching(configured, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.domains.sites import api
    from backend.services.workspace_service import get_workspace_context
    app = FastAPI()
    app.include_router(api.router, prefix='/api/vault')
    app.dependency_overrides[get_workspace_context] = lambda: configured.store.context
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    monkeypatch.setattr(api, 'store_for', lambda context: configured.store)
    with TestClient(app) as client:
        result = client.put('/api/vault/sites/' + configured.site.id + '/targets/local/credentials', json={'password': 'synthetic-secret'})
    assert result.status_code == 200 and result.json()['password_configured'] is True
    assert result.headers['cache-control'] == 'no-store'
    assert 'synthetic-secret' not in result.text and '_password' not in result.json()
