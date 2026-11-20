"""Native Pangea registration and real local PTY transfers without former tools."""
import contextlib
import json
import os
import shutil
import subprocess
from types import SimpleNamespace

import pexpect
import pytest
from fastapi import HTTPException

from backend.domains.sites import pangea, runtime
from backend.domains.sites.models import SiteConfig, SiteTarget
from backend.domains.sites.bounded_bridge import BoundedBridge, PangeaTransportInterrupted
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
    return SimpleNamespace(vault=vault, private_root=tmp_path / 'sites'), config


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


@pytest.fixture
def legacy_registration(registration, tmp_path, monkeypatch):
    store, _ = registration
    archive = tmp_path / 'archive'
    registered = archive / '.local/web-publishing/config.json'
    registered.parent.mkdir(parents=True)
    registered.write_text(json.dumps({'target': 'staging', 'vault_paths': [str(store.vault)]}))
    monkeypatch.delenv('GNOSI_PANGEA_CONFIG')
    monkeypatch.setenv('GNOSI_WEBSITE_IMPORT_ROOT', str(archive))
    return store


@pytest.mark.parametrize('bounded', [False, True])
def test_legacy_registration_discovers_the_effective_suweb_account_root(legacy_registration, tmp_path, monkeypatch, bounded):
    store = legacy_registration
    home = tmp_path / 'web-account'
    root = home / 'webapps/web'
    (root / 'web').mkdir(parents=True)
    getent = tmp_path / 'getent'
    getent.write_text('#!/bin/sh\n[ "$1" = passwd ] && [ "$2" = "$(id -u)" ] || exit 1\n'
                      'printf "web:x:%s:1::%s:/bin/sh\\n" "$2" "$TEST_SUWEB_HOME"\n')
    getent.chmod(0o700)
    env = {**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'], 'TEST_SUWEB_HOME': str(home)}

    def run_local_discovery(bridge, command):
        assert bridge.settings['WORKING_DIRECTORY'] == '/'
        return subprocess.check_output(['/bin/sh', '-ec', command], env=env, text=True)

    monkeypatch.setattr(BoundedBridge, 'run', run_local_discovery)
    with pangea.connection(store, bounded=bounded) as (driver, bridge):
        pangea.paths(driver, SiteConfig(name='Fixture'), bridge=bridge)
        assert driver.REMOTE_ROOT == str(root.resolve())
        assert bridge.settings['WORKING_DIRECTORY'] == driver.REMOTE_ROOT
    (root / 'web').rmdir()
    with pytest.raises(HTTPException) as failure, pangea.connection(store, bounded=bounded) as (driver, bridge):
        pangea.paths(driver, SiteConfig(name='Fixture'), bridge=bridge)
    assert failure.value.status_code == 409


def test_legacy_status_recovers_an_interrupted_directory_lookup(legacy_registration, monkeypatch):
    site = SiteConfig(name='Fixture')
    target = SiteTarget(id='pangea-staging', environment='staging', adapter='legacy-pangea',
                        base_url='https://temenosismael.org/_gnosi-proves/webs/' + site.id + '/current')
    site.targets.append(target)
    attempts = []

    def discover(bridge, command):
        attempts.append(bridge)
        if len(attempts) == 1:
            raise PangeaTransportInterrupted()
        return '/owned/recovered'

    def status(transport, bridge, public, private, owner, action, request):
        assert public.startswith('/owned/recovered/web/') and action == 'status'
        return {'test_mode': True}

    monkeypatch.setattr(BoundedBridge, 'run', discover)
    monkeypatch.setattr(pangea, '_service_request', status)
    monkeypatch.setattr(pangea.time, 'sleep', lambda _: None)
    assert pangea.service(legacy_registration, site, target.id, 'status', {}) == {'test_mode': True}
    assert len(attempts) == 2 and attempts[0] is attempts[1]


@pytest.mark.parametrize('mutation,status', [({'vault_paths': []}, 403), ({'target': 'unregistered'}, 409),
                                             ({'remote_root': None}, 409), ({'remote_root': '../other'}, 409)])
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
