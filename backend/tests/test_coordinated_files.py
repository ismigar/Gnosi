"""Cloud access contracts: bounded, cancellable and never a GUI side effect."""

import asyncio
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.platform.files import coordinated
from backend.platform.files.on_demand import OnDemandFilesProvider
from backend.services.vault_warmup import _critical_warmup_enabled


def test_flags_override_allocated_blocks_and_empty_local_files_are_not_cloud():
    assert coordinated.is_placeholder(SimpleNamespace(st_flags=0x40000000, st_blocks=8))
    assert not coordinated.is_placeholder(SimpleNamespace(st_flags=0, st_blocks=0, st_size=0))
    assert not coordinated.is_cloud_placeholder(
        Path('/tmp/sparse'), SimpleNamespace(st_flags=0, st_blocks=0, st_size=1000)
    )


def test_native_default_keeps_bulk_downloads_disabled(monkeypatch):
    monkeypatch.delenv('GNOSI_CRITICAL_WARMUP', raising=False)
    provider = OnDemandFilesProvider()
    provider.warmup_mode = 'coordinated'
    assert not _critical_warmup_enabled(provider)


def test_frozen_helper_is_a_resource_next_to_python(monkeypatch):
    monkeypatch.delenv('GNOSI_FILE_ACCESS_HELPER', raising=False)
    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    monkeypatch.setattr(sys, 'executable', '/Applications/Gnosi.app/Contents/Resources/python/cervell_backend')
    assert str(coordinated.helper_path()) == '/Applications/Gnosi.app/Contents/Resources/native/gnosi-file-access'


def test_helper_timeout_and_cancellation_reap_the_owned_child(monkeypatch):
    class Child:
        returncode = None
        killed = False

        async def wait(self):
            if self.returncode is None:
                await asyncio.Event().wait()
            return self.returncode

        def kill(self):
            self.killed = True
            self.returncode = -9

    monkeypatch.setattr(sys, 'platform', 'darwin')

    async def scenario(cancel):
        child = Child()
        launch = AsyncMock(return_value=child)
        monkeypatch.setattr(asyncio, 'create_subprocess_exec', launch)
        task = asyncio.create_task(coordinated.materialize_coordinated(Path('/tmp/document'), 0.1))
        await asyncio.sleep(0)
        if cancel:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            assert not await task
        assert child.killed
        assert launch.call_args.args[1] == '/tmp/document'

    asyncio.run(scenario(False))
    asyncio.run(scenario(True))


def test_provider_coalesces_and_limits_downloads_without_vendor_restart(monkeypatch):
    import backend.platform.files.on_demand as module
    provider = OnDemandFilesProvider(max_concurrent_warmups=2)
    provider.warmup_mode = 'coordinated'
    provider._recover_after_failed_warmup = AsyncMock(side_effect=AssertionError('no restart'))
    calls = []
    running = 0
    peak = 0

    async def materialize(path, timeout):
        nonlocal running, peak
        calls.append(path)
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.01)
        running -= 1
        return True

    monkeypatch.setattr(module, 'materialize_coordinated', materialize)

    async def scenario():
        paths = [Path('/tmp/a')] * 3 + [Path('/tmp/b'), Path('/tmp/c')]
        assert all(await asyncio.gather(*(provider.materialize(path) for path in paths)))

    asyncio.run(scenario())
    assert len(calls) == 3
    assert peak == 2
    assert not provider._inflight


def test_unavailable_helper_is_a_failure_not_a_gui_fallback(monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'darwin')
    launch = AsyncMock(side_effect=FileNotFoundError())
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', launch)
    assert not asyncio.run(coordinated.materialize_coordinated(Path('/tmp/document'), 1))
    assert launch.call_count == 1
    assert 'gnosi-file-access' in launch.call_args.args[0]


@pytest.mark.skipif(sys.platform != 'darwin', reason='macOS native contract')
def test_compiled_helper_is_read_only_and_rejects_directory_and_symlink(tmp_path):
    helper = coordinated.helper_path()
    if not helper.is_file():
        pytest.skip('Build desktop/scripts/file-access-build.cjs first')
    path = tmp_path / 'Nota amb accents i "cometes".md'
    path.write_bytes(b'---\nid: synthetic\n---\nUnchanged content\n')
    before = path.read_bytes()
    process = subprocess.run([str(helper), str(path)], capture_output=True, timeout=10)
    assert process.returncode == 0
    assert process.stdout == b'{"status":"materialized"}\n'
    assert path.read_bytes() == before
    link = tmp_path / 'link.md'
    link.symlink_to(path)
    for target in (tmp_path, link, tmp_path / 'missing.md'):
        assert subprocess.run([str(helper), str(target)], capture_output=True, timeout=10).returncode == 66
