"""Synthetic retention checks; no installed app or real user data are touched."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile

import pytest

SPEC = importlib.util.spec_from_file_location(
    'local_install_retention', Path(__file__).parents[1] / 'scripts/local_install_retention.py')
retention = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retention)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def sha(data):
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def installation(tmp_path, monkeypatch):
    root = tmp_path / 'gauntlet'
    root.mkdir()
    app = tmp_path / 'Gnosi.app'
    manifest = app / 'Contents/Resources/reconciled-build.json'
    write(manifest, {'source_commit': 'b' * 40})
    monkeypatch.setattr(retention, 'LOCK', tmp_path / 'installer.lock')

    def create(name, source, predecessor=None):
        run = root / name
        install = run / 'install'
        install.mkdir(parents=True)
        data = b'original application binary'
        inventory = {'Contents': {'mode': 0o755, 'type': 'directory'},
                     'Contents/binary': {'mode': 0o644, 'type': 'file',
                                         'size': len(data), 'sha256': sha(data)}}
        archive = install / 'before-install.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            member = tarfile.TarInfo('Contents')
            member.type = tarfile.DIRTYPE
            member.mode = 0o755
            bundle.addfile(member)
            member = tarfile.TarInfo('Contents/binary')
            member.mode = 0o644
            member.size = len(data)
            bundle.addfile(member, io.BytesIO(data))
        write(install / 'original-inventory.json', inventory)
        write(install / 'original-manifest.json', {'source_commit': predecessor})
        write(install / 'backup-result.json', {
            'archive': str(archive), 'sha256': sha(archive.read_bytes()),
            'entries': len(inventory), 'verified': True, 'bytes_modes_links_verified': True})
        manifest_hash = sha(manifest.read_bytes())
        write(install / 'installation-result.json', {
            'source_commit': source, 'manifest_sha256': manifest_hash,
            'signature_verified': True, 'components_verified': True})
        write(install / 'native-verification.json', {
            'status': 'passed', 'source_commit': source, 'app': str(app),
            'installation_manifest_sha256': manifest_hash, 'manifest_sha256': manifest_hash,
            'signature_verified': True, 'components_verified': True,
            'native_startup_verified': True})
        write(install / 'staged.json', {'source_commit': source,
              'components': {name: {} for name in retention.COMPONENTS}})
        (install / 'stage').mkdir()
        (install / 'rollback-components').mkdir()
        (install / 'rollback-signature').mkdir()
        (install / 'installer.py').write_text('# retained evidence')
        return run

    old = create('old', 'a' * 40)
    current = create('current', 'b' * 40, 'a' * 40)
    return root, current, app, old, create


def snapshot(root):
    return {str(path): path.read_bytes() for path in root.rglob('*') if path.is_file()}


def test_success_retains_one_and_idempotent(installation):
    root, run, app, old, _ = installation
    app_before = snapshot(app)
    report = retention.finalize(root, run, app, apply=True)
    assert len(list(root.rglob('*.tar.gz'))) == 1
    assert (run / 'install/before-install.tar.gz').exists()
    assert not (old / 'install/stage').exists()
    assert (old / 'install/installer.py').exists()
    assert snapshot(app) == app_before
    assert retention.finalize(root, run, app, apply=True) == report


def test_dry_run_preserves_everything(installation):
    root, run, app, _, _ = installation
    before = snapshot(root)
    report = retention.finalize(root, run, app)
    assert report['applied'] is False
    assert snapshot(root) == before
    assert (run / 'install/stage').exists()


@pytest.mark.parametrize('receipt', ['native-verification.json', 'backup-result.json',
                                      'installation-result.json', 'original-inventory.json',
                                      'staged.json'])
def test_missing_receipt_preserves_everything(installation, receipt):
    root, run, app, _, _ = installation
    (run / 'install' / receipt).unlink()
    before = snapshot(root)
    with pytest.raises((retention.RetentionError, OSError)):
        retention.finalize(root, run, app, apply=True)
    assert snapshot(root) == before
    assert (run / 'install/stage').exists()


@pytest.mark.parametrize('tamper', ['archive', 'inventory', 'manifest', 'native', 'source', 'foreign'])
def test_tamper_prevents_deletion(installation, tamper):
    root, run, app, _, _ = installation
    install = run / 'install'
    if tamper == 'archive':
        (install / 'before-install.tar.gz').write_bytes(b'corrupt')
    elif tamper == 'inventory':
        write(install / 'original-inventory.json', {'../escape': {}})
    elif tamper == 'manifest':
        (app / 'Contents/Resources/reconciled-build.json').write_text('{}')
    elif tamper == 'native':
        receipt = json.loads((install / 'native-verification.json').read_text())
        receipt['native_startup_verified'] = False
        write(install / 'native-verification.json', receipt)
    elif tamper == 'source':
        receipt = json.loads((install / 'staged.json').read_text())
        receipt['source_commit'] = 'c' * 40
        write(install / 'staged.json', receipt)
    else:
        (install / 'stage/user-data').write_text('preserve')
    before = snapshot(root)
    with pytest.raises((retention.RetentionError, OSError)):
        retention.finalize(root, run, app, apply=True)
    assert snapshot(root) == before


@pytest.mark.parametrize('kind', ['symlink', 'hardlink', 'external_backup', 'run_symlink'])
def test_unsafe_paths(installation, tmp_path, kind):
    root, run, app, _, _ = installation
    external = tmp_path / 'user-database'
    external.write_bytes(b'precious')
    if kind == 'symlink':
        (run / 'install/stage/link').symlink_to(external)
    elif kind == 'hardlink':
        os.link(external, run / 'install/stage/database')
    elif kind == 'external_backup':
        receipt = json.loads((run / 'install/backup-result.json').read_text())
        receipt['archive'] = str(external)
        write(run / 'install/backup-result.json', receipt)
    else:
        link = root / 'linked'
        link.symlink_to(run, target_is_directory=True)
        run = link
    with pytest.raises(retention.RetentionError):
        retention.finalize(root, run, app, apply=True)
    assert external.read_bytes() == b'precious'
    assert len(list(root.rglob('*.tar.gz'))) == 2


@pytest.mark.parametrize('kind', ['failed', 'active', 'corrupt', 'foreign'])
def test_incomplete_old_run_untouched(installation, kind):
    root, run, app, old, _ = installation
    install = old / 'install'
    if kind == 'active':
        (install / 'installation-result.json').unlink()
    elif kind == 'failed':
        (install / 'native-verification.json').unlink()
    elif kind == 'corrupt':
        (install / 'before-install.tar.gz').write_bytes(b'corrupt')
    else:
        (install / 'stage/foreign.txt').write_text('not installer data')
    before = snapshot(old)
    report = retention.finalize(root, run, app, apply=True)
    assert report['skipped']
    assert snapshot(old) == before
    assert (install / 'stage').exists()


def test_busy_lock_preserves_everything(installation):
    import fcntl
    root, run, app, _, _ = installation
    before = snapshot(root)
    with retention.LOCK.open('w') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(BlockingIOError):
            retention.finalize(root, run, app, apply=True)
    assert snapshot(root) == before


def at_second_success(monkeypatch, callback):
    original = retention.success
    calls = 0
    def wrapped(*args, **kwargs):
        nonlocal calls
        value = original(*args, **kwargs)
        if kwargs.get('current'):
            calls += 1
            if calls == 2:
                callback()
        return value
    monkeypatch.setattr(retention, 'success', wrapped)


def test_retained_archive_tamper_at_mutation_boundary(installation, monkeypatch):
    root, run, app, old, _ = installation
    old_archive = old / 'install/before-install.tar.gz'
    at_second_success(monkeypatch, lambda: (run / 'install/before-install.tar.gz').write_bytes(b'tampered'))
    with pytest.raises(retention.RetentionError, match='Retained backup changed'):
        retention.finalize(root, run, app, apply=True)
    assert old_archive.exists()
    assert (old / 'install/stage').exists()
    assert (run / 'install/stage').exists()


def test_stage_swap_cannot_delete_external_descendants(installation, tmp_path, monkeypatch):
    root, run, app, old, _ = installation
    stage = run / 'install/stage'
    (stage / 'frontend').mkdir()
    (stage / 'frontend/file').write_bytes(b'expected')
    staged = json.loads((run / 'install/staged.json').read_text())
    staged['components']['frontend'] = {
        '.': {'mode': 0o755, 'type': 'directory'},
        'file': {'mode': 0o644, 'type': 'file', 'size': 8, 'sha256': sha(b'expected')}}
    write(run / 'install/staged.json', staged)
    external = tmp_path / 'user-data'
    (external / 'frontend').mkdir(parents=True)
    precious = external / 'frontend/file'
    precious.write_bytes(b'user data')
    def swap():
        stage.rename(tmp_path / 'moved-stage')
        stage.symlink_to(external, target_is_directory=True)
    at_second_success(monkeypatch, swap)
    with pytest.raises(retention.RetentionError, match='identity changed'):
        retention.finalize(root, run, app, apply=True)
    assert precious.read_bytes() == b'user data'
    assert (old / 'install/before-install.tar.gz').exists()


@pytest.mark.parametrize('location', ['stage', 'rollback-components', 'rollback-signature'])
def test_cleanup_root_symlink_refused(installation, tmp_path, location):
    root, run, app, _, _ = installation
    external = tmp_path / 'external'
    external.mkdir()
    (external / 'keep').write_text('precious')
    path = run / 'install' / location
    path.rmdir()
    path.symlink_to(external, target_is_directory=True)
    with pytest.raises(retention.RetentionError, match='Symlink'):
        retention.finalize(root, run, app, apply=True)
    assert (external / 'keep').read_text() == 'precious'
    assert len(list(root.rglob('*.tar.gz'))) == 2


@pytest.mark.parametrize('missing', ['both', 'installation', 'native'])
def test_missing_manifest_binding_hashes_refused(installation, missing):
    root, run, app, _, _ = installation
    for filename, key, enabled in (
        ('installation-result.json', 'manifest_sha256', missing in ('both', 'installation')),
        ('native-verification.json', 'installation_manifest_sha256', missing in ('both', 'native'))):
        if enabled:
            path = run / 'install' / filename
            value = json.loads(path.read_text())
            del value[key]
            write(path, value)
    before = snapshot(root)
    with pytest.raises(retention.RetentionError, match='digest required'):
        retention.finalize(root, run, app, apply=True)
    assert snapshot(root) == before


def populate_stage(run):
    stage = run / 'install/stage'
    (stage / 'frontend').mkdir()
    (stage / 'frontend/file').write_bytes(b'expected')
    staged = json.loads((run / 'install/staged.json').read_text())
    staged['components']['frontend'] = {
        '.': {'mode': 0o755, 'type': 'directory'},
        'file': {'mode': 0o644, 'type': 'file', 'size': 8, 'sha256': sha(b'expected')}}
    write(run / 'install/staged.json', staged)
    return stage


def test_original_path_replacement_after_entry_check_is_preserved(installation, monkeypatch):
    root, run, app, _, _ = installation
    stage = populate_stage(run)
    original = retention.check_relative
    inserted = False
    def replace_after_check(parent_fd, name, expected, **kwargs):
        nonlocal inserted
        original(parent_fd, name, expected, **kwargs)
        if name == 'file' and not inserted:
            # An ordinary writer sees the old public path. The verified payload
            # is now private, so replacing this public name cannot affect unlink.
            inserted = True
            (stage / 'frontend').mkdir(parents=True)
            (stage / 'frontend/file').write_bytes(b'foreign user data')
    monkeypatch.setattr(retention, 'check_relative', replace_after_check)
    retention.finalize(root, run, app, apply=True)
    assert inserted
    assert (stage / 'frontend/file').read_bytes() == b'foreign user data'
    assert (run / 'install/before-install.tar.gz').exists()


def test_unknown_quarantined_content_preserved_and_reported(installation, monkeypatch):
    root, run, app, old, _ = installation
    populate_stage(run)
    original = retention.verify_tree_fd
    injected = False
    def inject(parent_fd, directory, records):
        nonlocal injected
        if not injected:
            injected = True
            child_fd = os.open(directory.name, os.O_RDONLY | os.O_DIRECTORY,
                               dir_fd=parent_fd)
            try:
                fd = os.open('unexpected', os.O_CREAT | os.O_WRONLY, 0o600, dir_fd=child_fd)
                os.write(fd, b'preserve unknown data')
                os.close(fd)
            finally:
                os.close(child_fd)
        original(parent_fd, directory, records)
    monkeypatch.setattr(retention, 'verify_tree_fd', inject)
    with pytest.raises(retention.RetentionError):
        retention.finalize(root, run, app, apply=True)
    leftovers = list((run / 'install').glob('.retention-quarantine-*'))
    assert len(leftovers) == 1
    assert (leftovers[0] / 'tree-0/unexpected').read_bytes() == b'preserve unknown data'
    assert (old / 'install/before-install.tar.gz').exists()
    report = retention.finalize(root, run, app)
    assert report['quarantine_leftovers'] == [str(leftovers[0])]


@pytest.mark.parametrize('tamper', [False, True])
def test_desktop_patch_derived_files_require_exact_recorded_bytes(installation, tamper):
    _, run, _, _, _ = installation
    install = run / 'install'
    original = json.loads((install / 'original-inventory.json').read_text())
    staged = json.loads((install / 'staged.json').read_text())
    def entry(data):
        return {'mode': 0o644, 'type': 'file', 'size': len(data), 'sha256': sha(data)}
    staged['components']['app.asar'] = {'.': entry(b'new shell')}
    write(install / 'staged.json', staged)
    (install / 'stage/app.asar').write_bytes(b'new shell')
    (install / 'rollback-components/app.asar').write_bytes(b'old shell')
    (install / 'rollback-signature/Info.plist').write_bytes(b'old integrity')
    original['Contents/Resources/app.asar'] = entry(b'old shell')
    original['Contents/Info.plist'] = entry(b'old integrity')
    if tamper:
        (install / 'rollback-signature/Info.plist').write_bytes(b'unrecorded')
        with pytest.raises(retention.RetentionError, match='Derived content mismatch'):
            retention.derived_paths(install, original)
    else:
        paths = retention.derived_paths(install, original)
        assert {path.name for path, _ in paths} == {
            'stage', 'rollback-components', 'rollback-signature'}


@pytest.mark.parametrize('names', [('frontend',), ('frontend', 'python'), ('app.asar',)])
def test_partial_component_installation_retains_verified_rollback(installation, names):
    root, run, app, _, _ = installation
    install = run / 'install'
    staged = json.loads((install / 'staged.json').read_text())
    staged['components'] = {}
    for name in names:
        data = ('new ' + name).encode()
        target = install / 'stage' / name
        entry = {'mode': 0o644, 'type': 'file', 'size': len(data), 'sha256': sha(data)}
        if name == 'app.asar':
            target.write_bytes(data)
            staged['components'][name] = {'.': entry}
        else:
            target.mkdir()
            (target / 'asset').write_bytes(data)
            staged['components'][name] = {
                '.': {'mode': 0o755, 'type': 'directory'}, 'asset': entry}
    write(install / 'staged.json', staged)
    before, app_before = snapshot(root), snapshot(app)
    preview = retention.finalize(root, run, app)
    assert preview['applied'] is False and snapshot(root) == before
    report = retention.finalize(root, run, app, apply=True)
    assert report['applied'] is True and snapshot(app) == app_before
    assert not (install / 'stage').exists()
    assert (install / 'before-install.tar.gz').exists()
    assert len(list(root.rglob('*.tar.gz'))) == 1


@pytest.mark.parametrize('declared', [None, [], {}, {'unknown': {}}, {'frontend': None}])
def test_invalid_partial_component_map_preserves_everything(installation, declared):
    root, run, app, _, _ = installation
    install = run / 'install'
    staged = json.loads((install / 'staged.json').read_text())
    staged['components'] = declared
    write(install / 'staged.json', staged)
    before = snapshot(root)
    with pytest.raises(retention.RetentionError, match='Unknown stage components'):
        retention.finalize(root, run, app, apply=True)
    assert snapshot(root) == before


@pytest.mark.parametrize('tamper', ['none', 'missing', 'bytes', 'mode', 'descendant', 'foreign'])
def test_plist_rollback_requires_exact_original_inventory(installation, tamper):
    _, run, _, _, _ = installation
    install = run / 'install'
    path = install / 'rollback-signature/Info.plist'
    data = b'original signing metadata'
    path.write_bytes(data)
    original = {'Contents/Info.plist': {
        'mode': 0o644, 'type': 'file', 'size': len(data), 'sha256': sha(data)}}
    if tamper == 'none':
        assert len(retention.derived_paths(install, original)) == 3
        return
    if tamper == 'missing':
        original = {}
    elif tamper == 'bytes':
        path.write_bytes(b'unrecorded')
    elif tamper == 'mode':
        path.chmod(0o600)
    elif tamper == 'descendant':
        path.unlink()
        path.mkdir()
        (path / 'user-data').write_bytes(data)
    else:
        (install / 'rollback-signature/user-data').write_bytes(data)
    with pytest.raises(retention.RetentionError):
        retention.derived_paths(install, original)
