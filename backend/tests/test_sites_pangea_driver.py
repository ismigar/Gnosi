"""Native Pangea registration and real local PTY transfers without former tools."""
import contextlib
import json
import os
import shutil
from types import SimpleNamespace

import pexpect
import pytest
from fastapi import HTTPException

from backend.domains.sites import pangea, runtime
from backend.domains.sites.models import SiteConfig, SiteTarget
from backend.domains.sites.bounded_bridge import BoundedBridge
from backend.domains.sites.bounded_child import DeadlineChild
from backend.domains.sites.pangea_driver import PangeaDriver


@pytest.fixture
def registration(tmp_path, monkeypatch):
    vault = tmp_path / 'vault'
    vault.mkdir()
    config = tmp_path / 'connection.json'
    config.write_text(json.dumps({'target': 'staging', 'vault_paths': [str(vault)], 'remote_root': '/owned/site'}))
    monkeypatch.setenv('GNOSI_PANGEA_CONFIG', str(config))
    monkeypatch.delenv('GNOSI_WEB_PUBLISH_DRIVER', raising=False)
    for key, value in {'SSH_HOST': 'host.invalid', 'SSH_USER': 'operator', 'SSH_PASSWORD': 'synthetic-login', 'SSH_SUWEB_PASSWORD': 'synthetic-web'}.items():
        monkeypatch.setenv(key, value)
    return SimpleNamespace(vault=vault), config


def test_registered_native_driver_needs_no_pilot_scripts(registration):
    store, config = registration
    driver = pangea.driver(store)
    assert isinstance(driver, PangeaDriver)
    assert driver.CONFIG == config and driver.REMOTE_ROOT == '/owned/site'
    with driver.bridge() as bridge:
        assert isinstance(bridge, BoundedBridge)
        assert bridge.settings['WORKING_DIRECTORY'] == '/owned/site'
        assert bridge.settings['SSH_PASSWORD'] == 'synthetic-login'
        assert bridge.child is None


def test_old_registration_location_is_data_only_and_never_executes_scripts(registration, tmp_path, monkeypatch):
    store, config = registration
    old = tmp_path / 'archive/scripts/web_publish_driver.py'
    old.parent.mkdir(parents=True)
    old.write_text('raise RuntimeError("Retired script was executed")')
    registered = old.parent.parent / '.local/web-publishing/config.json'
    registered.parent.mkdir(parents=True)
    shutil.copyfile(config, registered)
    monkeypatch.delenv('GNOSI_PANGEA_CONFIG')
    monkeypatch.setenv('GNOSI_WEB_PUBLISH_DRIVER', str(old))
    assert pangea.driver(store).CONFIG == registered
    old.unlink()
    assert pangea.driver(store).CONFIG == registered


@pytest.mark.parametrize('mutation,status', [({'vault_paths': []}, 403), ({'target': 'unregistered'}, 409)])
def test_native_driver_retains_registration_boundaries(registration, mutation, status):
    store, config = registration
    config.write_text(json.dumps({**json.loads(config.read_text()), **mutation}))
    with pytest.raises(HTTPException) as failure:
        pangea.driver(store)
    assert failure.value.status_code == status


@pytest.mark.parametrize('sqlite', [True, False])
def test_current_webs_probe_uses_native_runtime_check(registration, monkeypatch, sqlite):
    store, _ = registration
    site = SiteConfig(name='Native Pangea')
    target = SiteTarget(id='pangea-staging', environment='staging', adapter='legacy-pangea',
                        base_url='https://temenosismael.org/_gnosi-proves/webs/' + site.id + '/current')
    site.targets.append(target)
    from backend.domains.vault.publishing import web
    monkeypatch.setattr(web, '_driver', lambda *args: pytest.fail('Former publisher called'))

    def php(bridge, code):
        assert 'PHP_VERSION_ID' in code and 'pdo_sqlite' in code
        return json.dumps({'php': 80400, 'sqlite': sqlite})

    @contextlib.contextmanager
    def connection(context, *, bounded):
        assert context is store and bounded is True
        yield SimpleNamespace(php=php), object()

    monkeypatch.setattr(pangea, 'connection', connection)
    result = runtime.probe(store, site, target.id)
    assert result.configured and result.reachable is sqlite


@pytest.mark.skipif(not shutil.which('php'), reason='PHP is required')
@pytest.mark.parametrize('data', [b'', bytes(range(256)) * 1000])
def test_native_transfer_streams_exact_bytes_over_real_local_pty(tmp_path, data):
    source, destination = tmp_path / 'source.bin', tmp_path / "destination 'quoted'.bin"
    source.write_bytes(data)
    bridge = BoundedBridge({'WORKING_DIRECTORY': str(tmp_path)}, timeout=15)
    child = pexpect.spawn('/bin/bash', ['--noprofile', '--norc', '-i'], encoding='utf-8',
                          echo=False, env={**os.environ, 'PS1': 'web@local:~$ '})
    with bridge:
        bridge.child = DeadlineChild(child, bridge.remaining)
        bridge.expect(bridge.prompt)
        PangeaDriver('/owned/site', tmp_path / 'config.json', {}).put(bridge, source, str(destination))
        assert destination.read_bytes() == data
        assert bridge.run('printf transfer-complete') == 'transfer-complete'
    assert not child.isalive()
