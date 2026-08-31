"""Synthetic Drupal media contracts; no providers or personal files."""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from backend.domains.vault.drupal import core, media


@pytest.mark.parametrize("value", [None, [], "", False])
def test_empty_path_does_not_resolve_roots(value: object) -> None:
    def unexpected() -> Path:
        pytest.fail("empty values must not resolve roots")

    assert (
        media.resolve_local_path(value, media.DrupalPathDependencies(unexpected, unexpected))
        is None
    )


def test_path_list_first_item_url_and_cloud_reanchoring(tmp_path: Path) -> None:
    assets = tmp_path / "Assets"
    home = tmp_path / "home"
    cloud = home / "Library/CloudStorage/provider/image.png"
    cloud.parent.mkdir(parents=True)
    cloud.touch()
    dependencies = media.DrupalPathDependencies(lambda: assets, lambda: home)
    assert (
        media.resolve_local_path(["prefix/Assets/a.png", "ignored"], dependencies)
        == assets / "a.png"
    )
    assert (
        media.resolve_local_path(
            "file:///missing/Library/CloudStorage/provider/image.png", dependencies
        )
        == cloud
    )
    assert media.resolve_local_path("file:///tmp/a%20b.png", dependencies) == Path("/tmp/a b.png")


def test_path_string_error_remains_outside_path_resolution_catch(tmp_path: Path) -> None:
    error = ValueError("opaque path")

    class BadPath:
        def __str__(self) -> str:
            raise error

    with pytest.raises(ValueError) as caught:
        media.resolve_local_path(
            BadPath(), media.DrupalPathDependencies(lambda: tmp_path, lambda: tmp_path)
        )
    assert caught.value is error


def upload_dependencies(path: Path, events: list[object]) -> media.DrupalUploadDependencies:
    async def materialize(actual: Path, reason: str) -> object:
        events.append(("materialize", actual, reason))
        return object()

    def shrink(data: bytes, filename: str) -> tuple[bytes, str]:
        events.append(("shrink", data, filename))
        return data, filename

    async def find(filename: str, size: int) -> str | None:
        events.append(("find", filename, size))
        return None

    async def upload(bundle: str, field: str, filename: str, data: bytes) -> str:
        events.append(("upload", bundle, field, filename, data))
        return "file-uuid"

    return media.DrupalUploadDependencies(
        lambda value: path, materialize, shrink, shrink, find, upload
    )


def test_upload_preserves_source_metadata_caches_and_materialization_order(tmp_path: Path) -> None:
    path = tmp_path / "picture.png"
    path.write_bytes(b"synthetic bytes")
    events: list[object] = []
    dependencies = upload_dependencies(path, events)
    source = object()
    seen: list[object] = []

    def resolve(value: object) -> Path:
        seen.append(value)
        return path

    dependencies = replace(dependencies, resolve_local_path=resolve)
    cache: dict[str, str] = {}
    value = {"src": source, "alt": 17, "title": 21, 8: object()}
    first = asyncio.run(
        media.upload_field_image(
            value, "article", "image", {"title": "Fallback"}, cache, dependencies
        )
    )
    assert first == {
        "data": {"type": "file--file", "id": "file-uuid", "meta": {"alt": "17", "title": "21"}}
    }
    assert seen == [source] and seen[0] is source
    assert [event[0] for event in events] == ["materialize", "shrink", "find", "upload"]
    assert cache == {str(path): "file-uuid"}
    events.clear()
    second = asyncio.run(
        media.upload_field_image(value, "article", "image", {}, cache, dependencies)
    )
    assert second == first and [event[0] for event in events] == ["materialize"]


def test_upload_reuses_remote_file_and_pdf_branch(tmp_path: Path) -> None:
    path = tmp_path / "file.pdf"
    path.write_bytes(b"%PDF-synthetic")
    events: list[object] = []
    dependencies = upload_dependencies(path, events)

    async def existing(name: str, size: int) -> str:
        assert name == "smaller.pdf" and size == 6
        return "existing"

    dependencies = replace(
        dependencies,
        find_existing_file=existing,
        shrink_pdf=lambda data, name: (b"%PDF-x", "smaller.pdf"),
    )
    result = asyncio.run(media.upload_field_image("file", "article", "field", {}, {}, dependencies))
    assert result["data"]["id"] == "existing"
    assert [event[0] for event in events] == ["materialize"]


def test_missing_file_is_checked_after_materialization_even_if_cached(tmp_path: Path) -> None:
    path = tmp_path / "missing.png"
    events: list[object] = []
    with pytest.raises(RuntimeError, match="file not found:"):
        asyncio.run(
            media.upload_field_image(
                "file",
                "article",
                "field",
                {},
                {str(path): "cached"},
                upload_dependencies(path, events),
            )
        )
    assert [event[0] for event in events] == ["materialize"]


def test_signature_composite_uses_src_only_and_preserves_taxonomy_duplicates(
    tmp_path: Path,
) -> None:
    path = tmp_path / "file.png"
    path.write_bytes(b"data")
    source = object()
    seen: list[object] = []

    def resolve(value: object) -> Path:
        seen.append(value)
        return path

    dependencies = media.MediaSignatureDependencies(core.read_prop_value, resolve)
    result = media.media_signatures(
        {"image": "image", "tags": "tags"},
        {"image": {"id": "image"}, "tags": {"id": "tags"}},
        {"image": {"type": "image"}, "tags": {"type": "entity_reference"}},
        {"image": {"url": source}, "tags": [" B ", "a", "A", ""]},
        dependencies,
    )
    assert seen == [None]
    assert result == {"image": f"4:{int(path.stat().st_mtime)}", "tags": "tags:a|a|b"}


def test_signature_source_get_failure_is_not_caught() -> None:
    error = ValueError("src failed")

    class Composite(dict):
        def get(self, key):
            raise error

    with pytest.raises(ValueError) as caught:
        media.media_signatures(
            {"image": "image"},
            {"image": {"id": "image"}},
            {"image": {"type": "image"}},
            {"image": Composite(value=1)},
            media.MediaSignatureDependencies(core.read_prop_value, lambda value: None),
        )
    assert caught.value is error


def test_invalid_image_and_small_image_preserve_original_objects() -> None:
    raw = b"not an image"
    assert media.shrink_image(raw, "bad.png")[0] is raw
    buffer = BytesIO()
    Image.new("RGB", (3, 3), "red").save(buffer, "PNG")
    raw = buffer.getvalue()
    assert media.shrink_image(raw, "small.png")[0] is raw


@pytest.mark.parametrize("mode", ["RGBA", "RGB"])
def test_real_image_resize_and_transparency(mode: str) -> None:
    buffer = BytesIO()
    Image.new(mode, (60, 40)).save(buffer, "PNG", compress_level=0)
    raw = buffer.getvalue()
    shrunk, filename = media.shrink_image(
        raw, "image.png", media.DrupalImageSettings(max_dimension=20, web_target=0)
    )
    image = Image.open(BytesIO(shrunk))
    assert image.size == (20, 13) and filename == "image.png" and len(shrunk) < len(raw)
    assert image.mode == mode


def test_dynamic_pillow_member_is_resolved_at_call_time(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("late open")
    calls: list[str] = []

    def open_image(stream):
        calls.append("open")
        raise error

    monkeypatch.setattr(Image, "open", open_image)
    assert media.shrink_image(b"raw", "image.png") == (b"raw", "image.png")
    assert calls == ["open"]


def test_transparency_error_and_flat_graphic_error_keep_fallback() -> None:
    def convert(mode):
        raise ValueError("conversion failed")

    image = SimpleNamespace(mode="RGBA", convert=convert)
    assert media._has_transparency(image, "PNG") is True
    assert media._has_transparency(image, "JPEG") is False
    assert media._is_flat_graphic(image) is False


def test_upload_opaque_file_id_keeps_identity_in_relationship_and_cache(tmp_path: Path) -> None:
    path = tmp_path / "file.png"
    path.write_bytes(b"data")
    opaque = object()
    events: list[object] = []

    async def upload(bundle, field, filename, data):
        return opaque

    dependencies = replace(upload_dependencies(path, events), upload_image=upload)
    cache: dict[str, object] = {}
    result = asyncio.run(
        media.upload_field_image("file", "article", "image", {}, cache, dependencies)
    )
    assert result["data"]["id"] is opaque and cache[str(path)] is opaque


def test_signature_raw_mapping_error_is_not_swallowed() -> None:
    with pytest.raises(AttributeError, match="'int' object has no attribute 'items'"):
        media.media_signatures(
            7,
            {},
            {},
            {},
            media.MediaSignatureDependencies(core.read_prop_value, lambda value: None),
        )


def test_shrink_photographic_pixels_selects_jpeg() -> None:
    pixels = random.Random(7).randbytes(100 * 100 * 3)
    buffer = BytesIO()
    Image.frombytes("RGB", (100, 100), pixels).save(buffer, "PNG")
    raw = buffer.getvalue()
    result, filename = media.shrink_image(raw, "photo.png", media.DrupalImageSettings(web_target=0))
    assert filename == "photo.jpg" and len(result) < len(raw)
    assert Image.open(BytesIO(result)).format == "JPEG"


def test_pdf_failure_preserves_bytes_and_logs_without_external_process(monkeypatch, caplog) -> None:
    error = RuntimeError("synthetic gs failure")
    calls: list[object] = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        raise error

    monkeypatch.setattr(media.subprocess, "run", run)
    raw = b"%PDF-synthetic"
    assert media.shrink_pdf(raw, "file.pdf", logging.getLogger(__name__)) == (raw, "file.pdf")
    assert len(calls) == 1 and "synthetic gs failure" in caplog.text
