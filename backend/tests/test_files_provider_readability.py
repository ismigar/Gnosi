"""Allocated cloud blocks do not prove a file can be opened by the backend."""

import asyncio
from pathlib import Path
from threading import Event
from unittest.mock import AsyncMock

from backend.platform.files.on_demand import OnDemandFilesProvider


def test_native_warmup_recovers_a_file_with_blocks_but_a_rejected_read(tmp_path, monkeypatch):
    path = tmp_path / "history.jsonl"
    path.write_text('{"type":"worklog"}\n')
    provider = OnDemandFilesProvider()
    assert path.stat().st_blocks > 0
    original_open = Path.open
    ready = False

    def open_file(actual, *args, **kwargs):
        if actual == path and not ready:
            raise OSError(11, "Download incomplete")
        return original_open(actual, *args, **kwargs)

    async def open_reader(*args, **kwargs):
        nonlocal ready
        assert args[:6] == ("/usr/bin/open", "-g", "-j", "-a", "TextEdit", str(path))
        ready = True
        process = AsyncMock()
        process.returncode = 0
        process.communicate.return_value = (b"", b"")
        return process

    monkeypatch.setattr(Path, "open", open_file)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", open_reader)
    monkeypatch.setattr(asyncio, "sleep", AsyncMock())
    close_document = AsyncMock()
    monkeypatch.setattr(provider, "_close_helper_doc", close_document)

    assert asyncio.run(provider._open_and_wait(path, 1))
    close_document.assert_awaited_once_with(path, "TextEdit")
    assert path.read_text() == '{"type":"worklog"}\n'


def test_native_readability_probe_does_not_block_other_requests(tmp_path, monkeypatch):
    provider = OnDemandFilesProvider()
    probe_started = Event()
    probe_released = Event()

    def slow_probe(path):
        probe_started.set()
        assert probe_released.wait(2)
        return True

    monkeypatch.setattr(provider, "_is_materialized", slow_probe)

    async def scenario():
        request = asyncio.create_task(provider._open_and_wait(tmp_path / "history.jsonl"))
        try:
            assert await asyncio.to_thread(probe_started.wait, 1)
            # The loop must run this while the readability probe is still waiting.
            probe_released.set()
            assert await request
        finally:
            probe_released.set()

    asyncio.run(scenario())
