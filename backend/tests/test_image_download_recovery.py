"""Queued image materialization and serving stay bounded and observable."""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from backend.domains.vault.files.serving import probe_readable, serve_vault_image
from backend.domains.vault.files.state import FileServingState
from backend.platform.files.local import LocalProvider
from backend.platform.files.on_demand import OnDemandFilesProvider


class ControlledProvider(LocalProvider):
    def __init__(self) -> None:
        self.release = asyncio.Event()
        self.started = asyncio.Event()
        self.success = True
        self.calls = 0
        self.available = False

    def is_online_only(self, container_path, stat_result=None):
        return not self.available

    async def materialize(self, container_path: Path) -> bool:
        self.calls += 1
        self.started.set()
        await self.release.wait()
        self.available = self.success
        return self.success


def test_pending_download_coalesces_and_eventually_serves_original_image(tmp_path: Path):
    async def scenario():
        (tmp_path / "Images").mkdir()
        image = tmp_path / "Images" / "fixture.png"
        image.write_bytes(b"original image bytes")
        provider = ControlledProvider()
        state = FileServingState()
        for _ in range(3):
            with pytest.raises(HTTPException) as exc:
                await serve_vault_image(tmp_path, "fixture.png", state=state, provider=provider)
            assert exc.value.status_code == 503
            assert exc.value.headers["Retry-After"] == "3"
            assert exc.value.headers["X-Gnosi-File-Availability"] == "pending"
        await provider.started.wait()
        assert provider.calls == 1
        assert provider.warmup_status(image) == "pending"
        provider.release.set()
        await asyncio.sleep(0)
        response = await serve_vault_image(tmp_path, "fixture.png", state=state, provider=provider)
        assert Path(response.path).read_bytes() == b"original image bytes"
        assert response.headers["cache-control"] == "public, max-age=300"

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_owner", [True, False])
def test_cancelled_open_download_does_not_strand_or_cancel_other_waiters(cancel_owner: bool):
    async def scenario():
        provider = OnDemandFilesProvider()
        provider.warmup_mode = "open"
        entered = asyncio.Event()
        release = asyncio.Event()

        async def open_and_wait(_path, _timeout=None):
            entered.set()
            await release.wait()
            return True

        with patch.object(provider, "_open_and_wait", open_and_wait):
            owner = asyncio.create_task(provider.materialize(Path("fixture.png")))
            await entered.wait()
            waiter = asyncio.create_task(provider.materialize(Path("fixture.png")))
            survivor = asyncio.create_task(provider.materialize(Path("fixture.png")))
            await asyncio.sleep(0)
            cancelled = owner if cancel_owner else waiter
            cancelled.cancel()
            with pytest.raises(asyncio.CancelledError):
                await cancelled
            release.set()
            assert await asyncio.wait_for(survivor, 1) is (not cancel_owner)
            if cancel_owner:
                assert await asyncio.wait_for(waiter, 1) is False
            else:
                assert await asyncio.wait_for(owner, 1) is True

    asyncio.run(scenario())


def test_queued_download_remains_pending_before_its_provider_slot_opens():
    async def scenario():
        provider = OnDemandFilesProvider(max_concurrent_warmups=1)
        provider.warmup_mode = "open"
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def open_and_wait(_path, _timeout=None):
            nonlocal calls
            calls += 1
            entered.set()
            await release.wait()
            return True

        with patch.object(provider, "_open_and_wait", open_and_wait):
            provider.schedule_warmup(Path("first.png"))
            await entered.wait()
            provider.schedule_warmup(Path("queued.png"))
            await asyncio.sleep(0)
            assert calls == 1
            assert provider.warmup_status(Path("queued.png")) == "pending"
            provider.schedule_warmup(Path("queued.png"))
            release.set()
            for _ in range(10):
                await asyncio.sleep(0)
            assert calls == 2
            assert provider.warmup_status(Path("queued.png")) is None

    asyncio.run(scenario())


def test_allocated_but_unreadable_cloud_image_starts_recovery(tmp_path: Path):
    async def scenario():
        (tmp_path / "Images").mkdir()
        image = tmp_path / "Images" / "fixture.png"
        image.write_bytes(b"allocated but unavailable")
        provider = ControlledProvider()
        provider.name = "fileprovider"
        provider.available = True

        async def unavailable(_path):
            return OSError(11, "Resource deadlock avoided")

        with patch("backend.domains.vault.files.serving.probe_readable", unavailable):
            with pytest.raises(HTTPException) as exc:
                await serve_vault_image(tmp_path, "fixture.png", state=FileServingState(), provider=provider)
            assert exc.value.headers["X-Gnosi-File-Availability"] == "pending"
            await provider.started.wait()
            assert provider.calls == 1
            provider.release.set()
            await asyncio.sleep(0)

    asyncio.run(scenario())


def test_failed_download_does_not_relaunch_for_each_image_retry(tmp_path: Path):
    async def scenario():
        (tmp_path / "Images").mkdir()
        image = tmp_path / "Images" / "fixture.png"
        image.write_bytes(b"logical cloud image")
        provider = ControlledProvider()
        provider.success = False
        provider.release.set()
        with patch("backend.platform.files.base.time.monotonic", return_value=100):
            provider.schedule_warmup(image)
            await provider.started.wait()
            await asyncio.sleep(0)
            assert provider.warmup_status(image) == "failed"
            for _ in range(3):
                with pytest.raises(HTTPException) as exc:
                    await serve_vault_image(tmp_path, "fixture.png", state=FileServingState(), provider=provider)
                assert exc.value.headers["X-Gnosi-File-Availability"] == "failed"
                assert exc.value.headers["Retry-After"] == "30"
            assert provider.calls == 1
        with patch("backend.platform.files.base.time.monotonic", return_value=131):
            assert provider.warmup_status(image) is None
            provider.success = True
            provider.schedule_warmup(image)
            await asyncio.sleep(0)
            assert provider.calls == 2
            assert provider.warmup_status(image) is None

    asyncio.run(scenario())


def test_blocking_image_probe_does_not_stall_unrelated_requests(tmp_path: Path):
    entered = threading.Event()
    release = threading.Event()
    original_open = Path.open

    def slow_open(path, *args, **kwargs):
        entered.set()
        assert release.wait(2)
        return original_open(path, *args, **kwargs)

    async def scenario():
        image = tmp_path / "fixture.png"
        image.write_bytes(b"image")
        with patch.object(Path, "open", slow_open):
            task = asyncio.create_task(probe_readable(image))
            try:
                for _ in range(100):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.001)
                assert entered.is_set()
                assert not task.done()
                # This coroutine can make progress while the file read waits.
                release.set()
                assert await task is None
            finally:
                release.set()
                await task

    asyncio.run(scenario())
