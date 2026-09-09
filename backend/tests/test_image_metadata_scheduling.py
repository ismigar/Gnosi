"""Image metadata work is bounded, fresh, contained and off the event loop."""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.domains.vault.files import serving
from backend.domains.vault.files.state import FileServingState
from backend.platform.files.local import LocalProvider


def _image(vault: Path) -> Path:
    directory = vault / "Images"
    directory.mkdir()
    image = directory / "fixture.png"
    image.write_bytes(b"original image bytes")
    return image


def test_image_metadata_and_provider_checks_do_not_block_the_event_loop(tmp_path, monkeypatch):
    image = _image(tmp_path)
    entered = threading.Event()
    release = threading.Event()
    loop_thread = threading.get_ident()
    original_resolve = Path.resolve

    def delayed_resolve(path, *args, **kwargs):
        if path == image:
            assert threading.get_ident() != loop_thread
            entered.set()
            assert release.wait(timeout=2)
        return original_resolve(path, *args, **kwargs)

    class InspectingProvider(LocalProvider):
        def is_online_only(self, container_path, stat_result=None):
            assert threading.get_ident() != loop_thread
            assert stat_result is not None
            return False

    monkeypatch.setattr(Path, "resolve", delayed_resolve)

    async def scenario():
        request = asyncio.create_task(serving.serve_vault_image(
            tmp_path, image.name, state=FileServingState(), provider=InspectingProvider()
        ))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            await asyncio.sleep(0)
            assert not request.done()
        finally:
            release.set()
        response = await asyncio.wait_for(request, 2)
        assert response.path == str(image)

    asyncio.run(scenario())


def test_image_metadata_respects_the_existing_concurrency_limit(tmp_path, monkeypatch):
    image = _image(tmp_path)
    original = serving._inspect_vault_image
    lock = threading.Lock()
    release = threading.Event()
    two_started = threading.Event()
    active = maximum = calls = 0

    def controlled_inspect(*args):
        nonlocal active, maximum, calls
        with lock:
            active += 1
            calls += 1
            maximum = max(maximum, active)
            if active == 2:
                two_started.set()
        try:
            assert release.wait(timeout=2)
            return original(*args)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(serving, "_inspect_vault_image", controlled_inspect)

    async def scenario():
        state = FileServingState(concurrency=2)
        tasks = [asyncio.create_task(serving.serve_vault_image(
            tmp_path, image.name, state=state, provider=LocalProvider()
        )) for _ in range(5)]
        try:
            assert await asyncio.to_thread(two_started.wait, 1)
            await asyncio.sleep(0)
            assert calls == 2
        finally:
            release.set()
        responses = await asyncio.gather(*tasks)
        assert len(responses) == 5
        assert calls == 5
        assert maximum == 2

    asyncio.run(scenario())


def test_image_response_reuses_one_fresh_stat_without_cross_request_cache(tmp_path, monkeypatch):
    image = _image(tmp_path)
    original_stat = Path.stat
    image_stats = []

    def counted_stat(path, *args, **kwargs):
        result = original_stat(path, *args, **kwargs)
        if path == image:
            image_stats.append(result)
        return result

    # Isolate the redundant target stat calls from realpath's platform-specific
    # symlink metadata. Containment uses real resolution in the separate cases.
    monkeypatch.setattr(Path, "resolve", lambda path: path)
    monkeypatch.setattr(Path, "stat", counted_stat)

    async def scenario():
        response = await serving.serve_vault_image(
            tmp_path, image.name, state=FileServingState(), provider=LocalProvider()
        )
        assert len(image_stats) == 1
        assert response.stat_result is image_stats[0]
        assert response.headers["content-length"] == str(len(b"original image bytes"))
        image.write_bytes(b"changed bytes")
        changed = await serving.serve_vault_image(
            tmp_path, image.name, state=FileServingState(), provider=LocalProvider()
        )
        assert len(image_stats) == 2
        assert changed.stat_result is image_stats[1]
        assert changed.headers["content-length"] == str(len(b"changed bytes"))
        assert changed.headers["cache-control"] == "public, max-age=300"

    asyncio.run(scenario())


@pytest.mark.parametrize("selection, expected", [
    ("../outside.png", 403),
    ("%2e%2e/outside.png", 403),
    ("escaped.png", 403),
    ("nested", 404),
    ("missing.png", 404),
])
def test_worker_image_inspection_preserves_containment_and_regular_file_checks(
    tmp_path, monkeypatch, selection, expected
):
    _image(tmp_path)
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"must not be served")
    (tmp_path / "Images" / "escaped.png").symlink_to(outside)
    (tmp_path / "Images" / "nested").mkdir()

    async def forbidden_probe(_path):
        pytest.fail("An invalid or escaped file must never reach the read probe")

    monkeypatch.setattr(serving, "probe_readable", forbidden_probe)
    with pytest.raises(HTTPException) as error:
        asyncio.run(serving.serve_vault_image(
            tmp_path, selection, state=FileServingState(), provider=LocalProvider()
        ))
    assert error.value.status_code == expected
