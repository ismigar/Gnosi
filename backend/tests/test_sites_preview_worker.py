"""Real isolated preview failures stay local and clean up their owned state."""
import os
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.domains.sites import preview_worker as worker, runtime
from backend.tests.test_sites import website  # noqa: F401


def test_invalid_target_returns_original_error_without_mutating_site(website):
    before = website.store.config_path(website.site.id).read_bytes()
    with pytest.raises(HTTPException) as error:
        worker.run_isolated(website.store, website.site, 'missing-target')
    assert error.value.status_code == 409
    assert website.store.config_path(website.site.id).read_bytes() == before
    with website.store.database() as db:
        assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM previews').fetchone()[0] == 0
    assert not list(website.store.private_root.rglob('server.json'))


def test_worker_refuses_unowned_process_group(tmp_path):
    # Running without the parent's private session cannot touch any workspace.
    result = subprocess.run([sys.executable, str(Path(worker.__file__)), '0', '0', '0', '0', str(os.getpid())], timeout=15)
    assert result.returncode == 74


def test_wait_rejects_unexpected_channel_output():
    parent, child = socket.socketpair()
    try:
        child.sendall(b'X')
        with pytest.raises(OSError, match='unexpectedly'):
            worker._wait(parent, None)
    finally:
        parent.close()
        child.close()


def test_php_finder_path_fallback_preserves_environment(monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'darwin')
    monkeypatch.setenv('PATH', '/usr/bin:/bin')
    calls = []
    def which(program, path=None):
        calls.append((program, path))
        return '/opt/homebrew/bin/php' if path else None
    monkeypatch.setattr(runtime.shutil, 'which', which)
    assert runtime._php_executable() == '/opt/homebrew/bin/php'
    assert calls == [('php', None), ('php', '/opt/homebrew/bin:/usr/local/bin')]
    assert os.environ['PATH'] == '/usr/bin:/bin'


def test_php_explicit_path_takes_precedence(monkeypatch):
    calls = []
    def which(program, path=None):
        calls.append(path)
        return '/custom/php'
    monkeypatch.setattr(runtime.shutil, 'which', which)
    assert runtime._php_executable() == '/custom/php'
    assert calls == [None]


def test_failed_group_leader_does_not_leave_its_child(tmp_path):
    import signal
    import time
    import psutil
    pid_file = tmp_path / 'child.pid'
    script = "import subprocess,sys;from pathlib import Path;p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);Path(sys.argv[1]).write_text(str(p.pid))"
    leader = subprocess.Popen([sys.executable, '-c', script, str(pid_file)], start_new_session=True)
    child = None
    try:
        leader.wait(timeout=10)
        child = psutil.Process(int(pid_file.read_text()))
        assert child.is_running()
        worker._kill_group(leader)
        deadline = time.monotonic() + 3
        while child.is_running() and child.status() != psutil.STATUS_ZOMBIE and time.monotonic() < deadline:
            time.sleep(.02)
        assert not child.is_running() or child.status() == psutil.STATUS_ZOMBIE
    finally:
        if child is not None and child.is_running() and child.status() != psutil.STATUS_ZOMBIE:
            os.kill(child.pid, signal.SIGKILL)


def test_blocked_read_deadline_kills_only_owned_preview_group(tmp_path):
    import signal
    import psutil
    pid_file = tmp_path / 'reader-child.pid'
    script = """
import os,sys,time,subprocess
from pathlib import Path
from backend.domains.sites.preview_worker import _OwnedReader
from backend.utils import bounded_file_io
p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
Path(sys.argv[1]).write_text(str(p.pid))
reader=_OwnedReader();reader.timeout=.05
bounded_file_io._operation=lambda *a:time.sleep(60)
reader.run(0,10)
"""
    process = subprocess.Popen([sys.executable, '-c', script, str(pid_file)], start_new_session=True)
    child = None
    try:
        assert process.wait(timeout=10) == -signal.SIGKILL
        child = psutil.Process(int(pid_file.read_text()))
        assert not child.is_running() or child.status() == psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        pass
    finally:
        if process.poll() is None:
            worker._kill_group(process)
        if child is not None and child.is_running() and child.status() != psutil.STATUS_ZOMBIE:
            child.kill()


def test_parse_reuse_still_reads_fresh_bytes_and_does_not_share_metadata(website, monkeypatch):
    from backend.domains.sites import exporter
    token = exporter.parsed_note_cache.set({})
    original = exporter.bounded_read
    reads = []
    def read(path, *args):
        reads.append(path)
        return original(path, *args)
    monkeypatch.setattr(exporter, 'bounded_read', read)
    path = website.vault / 'BD/Articles/one.md'
    try:
        first = exporter._read_note(path, website.vault)
        first.metadata['private'] = True
        second = exporter._read_note(path, website.vault)
        assert 'private' not in second.metadata
        assert len(reads) == 2
        path.write_text(path.read_text().replace('id: one', 'id: replaced'))
        third = exporter._read_note(path, website.vault)
        assert third.metadata['id'] == 'replaced'
        assert third.digest != second.digest
        assert len(reads) == 3
        path.unlink()
        with pytest.raises(HTTPException):
            exporter._read_note(path, website.vault)
    finally:
        exporter.parsed_note_cache.reset(token)


@pytest.mark.parametrize('change', ['file', 'parent_alias', 'root'])
def test_pinned_fast_read_rejects_path_changes(tmp_path, change):
    from backend.domains.sites import asset_files
    root = tmp_path / 'root'
    folder = root / 'folder'
    folder.mkdir(parents=True)
    path = folder / 'item.md'
    path.write_text('first')
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'item.md').write_text('other')
    with asset_files.parent_descriptor_cache(), asset_files.read_session():
        # Establish the owned root before exercising the optimized walk.
        assert asset_files.read_selected_bytes(path, root, 100) == b'first'
        with pytest.raises(asset_files.SourceChanged):
            with asset_files._source(path, 100, root) as (stream, size):
                assert stream.read() == b'first'
                if change == 'file':
                    replacement = folder / 'new.md'
                    replacement.write_text('other')
                    replacement.replace(path)
                elif change == 'parent_alias':
                    folder.rename(root / 'old')
                    folder.symlink_to(outside, target_is_directory=True)
                else:
                    root.rename(tmp_path / 'old-root')
                    root.mkdir()


def test_pinned_read_preserves_internal_parent_alias_support(tmp_path):
    from backend.domains.sites import asset_files
    root = tmp_path / 'root'
    folder = root / 'folder'
    folder.mkdir(parents=True)
    path = folder / 'item.md'
    path.write_text('content')
    (root / 'alias').symlink_to(folder, target_is_directory=True)
    with asset_files.parent_descriptor_cache(), asset_files.read_session():
        assert asset_files.read_selected_bytes(path, root, 100) == b'content'
        assert asset_files.read_selected_bytes(root / 'alias/item.md', root, 100) == b'content'


def test_watchdog_failure_cleans_registered_preview_files(website, monkeypatch, tmp_path):
    import signal
    import psutil
    receipt = tmp_path / 'child.pid'
    program = r"""
import os,sys,time,subprocess
from pathlib import Path
from backend.domains.sites import preview_worker as worker
from backend.utils import bounded_file_io
def perform(payload,descriptor):
    root=Path(payload['private_root'])/payload['site']['id']/'previews'/payload['identity']
    for name in ('public','work'):
        (root/name).mkdir(parents=True,exist_ok=True)
        (root/name/'marker').write_text('disposable')
    child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
    Path(sys.argv[6]).write_text(str(child.pid))
    reader=worker._OwnedReader();reader.timeout=.05
    bounded_file_io._operation=lambda *args:time.sleep(60)
    reader.run(0,10)
worker._perform=perform
raise SystemExit(worker.worker_main(*(int(value) for value in sys.argv[1:6])))
"""
    monkeypatch.setattr(worker, '_command', lambda descriptors: [sys.executable, '-c', program, *map(str, descriptors), str(os.getpid()), str(receipt)])
    child = None
    try:
        with pytest.raises(OSError):
            worker.run_isolated(website.store, website.site, 'local')
        child = psutil.Process(int(receipt.read_text()))
        assert not child.is_running() or child.status() == psutil.STATUS_ZOMBIE
        assert not list(website.store.private_root.rglob('marker'))
        with website.store.database() as db:
            assert db.execute('SELECT COUNT(*) FROM previews').fetchone()[0] == 0
    except psutil.NoSuchProcess:
        assert not list(website.store.private_root.rglob('marker'))
    finally:
        if child is not None and child.is_running() and child.status() != psutil.STATUS_ZOMBIE:
            os.kill(child.pid, signal.SIGKILL)


def test_persistent_parse_cache_authenticates_metadata_and_reads_fresh_source(website, monkeypatch):
    import json
    from backend.domains.sites import exporter, note_parse_cache
    path = website.vault / 'BD/Articles/one.md'
    real_load = exporter.yaml.load
    calls = []
    def load(*args, **kwargs):
        calls.append(True)
        return real_load(*args, **kwargs)
    monkeypatch.setattr(exporter.yaml, 'load', load)
    def read():
        with note_parse_cache.parsed_metadata(website.store.private_root) as cache:
            token = exporter.parsed_note_cache.set(cache)
            try:
                return exporter._read_note(path, website.vault)
            finally:
                exporter.parsed_note_cache.reset(token)
    assert read().metadata['id'] == 'one'
    assert len(calls) == 1
    assert read().metadata['id'] == 'one'
    assert len(calls) == 1
    path.write_text(path.read_text().replace('id: one', 'id: replaced'))
    assert read().metadata['id'] == 'replaced'
    assert len(calls) == 2
    cache_path = website.store.private_root / 'note-parse-cache.json'
    envelope = json.loads(cache_path.read_text())
    data = json.loads(envelope['payload'])
    for digest in data:
        data[digest] = json.dumps({'id': 'FORGED', 'public': True})
    envelope['payload'] = json.dumps(data)
    cache_path.write_text(json.dumps(envelope))
    assert read().metadata['id'] == 'replaced'
    assert len(calls) == 3
    path.unlink()
    with pytest.raises(HTTPException):
        read()


def test_parse_cache_key_alias_is_inert(website, tmp_path):
    from backend.domains.sites.note_parse_cache import parsed_metadata
    outside = tmp_path / 'unrelated'
    outside.write_bytes(b'x' * 32)
    key = website.store.private_root / '.note-parse-cache-key'
    key.symlink_to(outside)
    with parsed_metadata(website.store.private_root) as cache:
        cache['a' * 64] = '{}'
    assert outside.read_bytes() == b'x' * 32
    assert key.is_symlink()
    assert not (website.store.private_root / 'note-parse-cache.json').exists()
