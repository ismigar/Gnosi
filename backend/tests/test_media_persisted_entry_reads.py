"""Persisted gallery indexes validate all rows while decoding only selected Paths."""

from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import Mock
import json
import logging

import pytest

from backend.domains.media import scan_cache
from backend.services.media_service import MediaService

LOG = logging.getLogger(__name__)


def test_first_and_last_pages_construct_only_their_selected_paths(monkeypatch, tmp_path):
    target = tmp_path / "Images"
    target.mkdir()
    cache_file = tmp_path / "scan.json"
    count = 57_150
    cache_file.write_text(json.dumps({"ts": 100, "entries": [
        [f"{target}/photo-{index:05d}.jpg", count - index] for index in range(count)
    ]}))
    construct_path = Mock(side_effect=Path)
    monkeypatch.setattr(scan_cache, "Path", construct_path)
    loaded = scan_cache.load_persisted(target, lambda _: cache_file, LOG)
    assert loaded is not None and len(loaded[1]) == count
    construct_path.assert_not_called()
    service = MediaService()
    monkeypatch.setattr(service, "_resolve_album_dir", lambda *_, **__: target)
    monkeypatch.setattr(service, "_scan_with_cache", lambda *_, **__: loaded[1])
    monkeypatch.setattr(service, "_get_file_info", lambda path, **_: {"filename": path.name})
    page = service.get_all_media(limit=50)
    assert page["total"] == count and len(page["items"]) == 50
    assert construct_path.call_count == 50
    assert page["items"][0]["filename"] == "photo-00000.jpg"
    construct_path.reset_mock()
    final_page = service.get_all_media(limit=50, offset=count - 7)
    assert final_page["total"] == count and len(final_page["items"]) == 7
    assert construct_path.call_count == 7
    assert final_page["items"][-1]["filename"] == "photo-57149.jpg"


def test_lazy_entries_preserve_slices_negative_indexes_and_immutability():
    entries = scan_cache._decode_entries([["a.jpg", 3], ["b.jpg", "2"], ["c.jpg", 1]])
    assert entries[-1] == (Path("c.jpg"), 1.0)
    assert list(entries[::-1]) == [(Path("c.jpg"), 1.0), (Path("b.jpg"), 2.0), (Path("a.jpg"), 3.0)]
    assert list(entries[1:2]) == [(Path("b.jpg"), 2.0)]
    assert list(entries[20:]) == []
    with pytest.raises(IndexError):
        _ = entries[3]
    with pytest.raises(FrozenInstanceError):
        entries._rows = ()


def test_lazy_entries_preserve_filtering_and_sorting(monkeypatch, tmp_path):
    target = tmp_path / "Images"
    target.mkdir()
    rows = [[str(target / "b.jpg"), 1], [str(target / "clip.mp4"), 2], [str(target / "a.jpg"), 3]]
    entries = scan_cache._decode_entries(rows)
    service = MediaService()
    monkeypatch.setattr(service, "_resolve_album_dir", lambda *_, **__: target)
    monkeypatch.setattr(service, "_root_dir", lambda *_: target)
    monkeypatch.setattr(service, "_scan_with_cache", lambda *_, **__: entries)
    monkeypatch.setattr(service, "_get_file_info", lambda path, **_: {"filename": path.name})
    page = service.get_all_media(kinds="image", sort="filename", dir_="asc", limit=1, offset=1)
    assert page["total"] == 2 and page["items"] == [{"filename": "b.jpg"}]
    assert list(entries) == [(Path(path), float(mtime)) for path, mtime in rows]


@pytest.mark.parametrize("invalid", [
    None, {}, "wrong", [["only-path"]], [[123, 1]], [["", 1]],
    [["bad\x00path", 1]], [["a.jpg", {}]], [["a.jpg", "not-a-time"]], [["a.jpg", float("nan")]],
])
def test_corrupt_persisted_rows_are_rejected_before_any_page(monkeypatch, tmp_path, invalid):
    cache_file = tmp_path / "scan.json"
    cache_file.write_text(json.dumps({"ts": 100, "entries": invalid}))
    construct_path = Mock(side_effect=Path)
    monkeypatch.setattr(scan_cache, "Path", construct_path)
    assert scan_cache.load_persisted(tmp_path, lambda _: cache_file, LOG) is None
    construct_path.assert_not_called()


def test_corruption_outside_the_first_page_is_not_deferred_to_pagination(tmp_path):
    cache_file = tmp_path / "scan.json"
    rows = [[f"photo-{index}.jpg", index] for index in range(50)]
    cache_file.write_text(json.dumps({"ts": 100, "entries": [*rows, ["bad.jpg", "bad-time"]]}))
    assert scan_cache.load_persisted(tmp_path, lambda _: cache_file, LOG) is None
