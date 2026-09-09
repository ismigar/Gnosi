"""Freshness, isolation and concurrent reads of configuration files."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest
import yaml

from backend.config.yaml_cache import ConfigYamlCache

LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)


def write_config(path: Path, language: str) -> None:
    path.write_text(f"settings: {{language: {language}, extension: [one, two]}}\n", encoding="utf-8")


def test_unchanged_document_is_decoded_once_and_copies_are_independent(tmp_path, monkeypatch):
    path = tmp_path / "params.yaml"
    write_config(path, "ca")
    cache = ConfigYamlCache()
    original_load = yaml.load
    calls = []

    def load(*args, **kwargs):
        calls.append(1)
        return original_load(*args, **kwargs)

    monkeypatch.setattr(yaml, "load", load)
    first = cache.read(path, LOADER)
    first["settings"]["extension"].append("edited")
    second = cache.read(path, LOADER)
    second["settings"]["language"] = "es"
    assert cache.read(path, LOADER) == {
        "settings": {"language": "ca", "extension": ["one", "two"]}
    }
    assert len(calls) == 1


@pytest.mark.parametrize("replacement", [False, True])
def test_same_size_and_mtime_edits_are_visible_immediately(tmp_path, replacement):
    path = tmp_path / "params.yaml"
    write_config(path, "ca")
    cache = ConfigYamlCache()
    first = cache.read(path, LOADER)
    before = path.stat()
    target = tmp_path / "replacement.yaml" if replacement else path
    write_config(target, "fr")
    os.utime(target, ns=(before.st_atime_ns, before.st_mtime_ns))
    if replacement:
        target.replace(path)
    assert path.stat().st_size == before.st_size
    assert path.stat().st_mtime_ns == before.st_mtime_ns
    assert cache.read(path, LOADER)["settings"]["language"] == "fr"
    assert first["settings"]["language"] == "ca"


def test_replacement_during_decode_does_not_cache_the_opened_old_file(tmp_path, monkeypatch):
    path = tmp_path / "params.yaml"
    replacement = tmp_path / "replacement.yaml"
    write_config(path, "ca")
    write_config(replacement, "fr")
    cache = ConfigYamlCache()
    original_load = yaml.load
    calls = []

    def replace_while_reading(handle, **kwargs):
        calls.append(1)
        result = original_load(handle, **kwargs)
        if len(calls) == 1:
            replacement.replace(path)
        return result

    monkeypatch.setattr(yaml, "load", replace_while_reading)
    assert cache.read(path, LOADER)["settings"]["language"] == "ca"
    assert cache.read(path, LOADER)["settings"]["language"] == "fr"
    assert cache.read(path, LOADER)["settings"]["language"] == "fr"
    assert len(calls) == 2


def test_unreadable_metadata_never_serves_a_cached_document(tmp_path, monkeypatch):
    path = tmp_path / "params.yaml"
    write_config(path, "ca")
    cache = ConfigYamlCache()
    cache.read(path, LOADER)
    original_stat = Path.stat

    def unavailable(candidate, *args, **kwargs):
        if candidate == path:
            raise PermissionError("synthetic cloud metadata failure")
        return original_stat(candidate, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "stat", unavailable)
        with pytest.raises(PermissionError):
            cache.read(path, LOADER)
    write_config(path, "fr")
    assert cache.read(path, LOADER)["settings"]["language"] == "fr"


def test_permission_change_requires_reopening_the_file(tmp_path, monkeypatch):
    path = tmp_path / "params.yaml"
    write_config(path, "ca")
    cache = ConfigYamlCache()
    cache.read(path, LOADER)
    path.chmod(0o200)
    original_open = Path.open

    def denied(candidate, *args, **kwargs):
        if candidate == path:
            raise PermissionError("synthetic read denied")
        return original_open(candidate, *args, **kwargs)

    try:
        with monkeypatch.context() as patch:
            patch.setattr(Path, "open", denied)
            with pytest.raises(PermissionError):
                cache.read(path, LOADER)
    finally:
        path.chmod(0o600)
    assert cache.read(path, LOADER)["settings"]["language"] == "ca"


def test_deleted_and_malformed_files_do_not_keep_previous_values(tmp_path):
    path = tmp_path / "params.yaml"
    write_config(path, "ca")
    cache = ConfigYamlCache()
    cache.read(path, LOADER)
    path.unlink()
    with pytest.raises(FileNotFoundError):
        cache.read(path, LOADER)
    path.write_text("settings: [\n", encoding="utf-8")
    with pytest.raises(yaml.YAMLError):
        cache.read(path, LOADER)
    write_config(path, "fr")
    assert cache.read(path, LOADER)["settings"]["language"] == "fr"


def test_concurrent_miss_is_shared_without_blocking_another_vault(tmp_path, monkeypatch):
    first, second = tmp_path / "first.yaml", tmp_path / "second.yaml"
    write_config(first, "ca")
    write_config(second, "fr")
    cache = ConfigYamlCache()
    entered, release = Event(), Event()
    original_load = yaml.load
    calls = []

    def slow_load(handle, **kwargs):
        calls.append(Path(handle.name))
        if Path(handle.name) == first:
            entered.set()
            assert release.wait(3)
        return original_load(handle, **kwargs)

    monkeypatch.setattr(yaml, "load", slow_load)
    with ThreadPoolExecutor(max_workers=5) as pool:
        owner = pool.submit(cache.read, first, LOADER)
        assert entered.wait(2)
        followers = [pool.submit(cache.read, first, LOADER) for _ in range(2)]
        try:
            independent = pool.submit(cache.read, second, LOADER).result(timeout=2)
            assert independent["settings"]["language"] == "fr"
        finally:
            release.set()
        documents = [future.result(timeout=2) for future in [owner, *followers]]
    assert calls.count(first) == 1
    documents[0]["settings"]["language"] = "es"
    assert all(document["settings"]["language"] == "ca" for document in documents[1:])


def test_relative_paths_remain_specific_to_their_current_directory(tmp_path, monkeypatch):
    first, second = tmp_path / "first", tmp_path / "second"
    first.mkdir()
    second.mkdir()
    write_config(first / "params.yaml", "ca")
    write_config(second / "params.yaml", "fr")
    cache = ConfigYamlCache()
    monkeypatch.chdir(first)
    assert cache.read(Path("params.yaml"), LOADER)["settings"]["language"] == "ca"
    monkeypatch.chdir(second)
    assert cache.read(Path("params.yaml"), LOADER)["settings"]["language"] == "fr"


def test_cache_eviction_and_large_files_bound_reuse(tmp_path, monkeypatch):
    paths = [tmp_path / f"{number}.yaml" for number in range(3)]
    for path in paths:
        write_config(path, "ca")
    original_load = yaml.load
    calls = []

    def load(*args, **kwargs):
        calls.append(1)
        return original_load(*args, **kwargs)

    monkeypatch.setattr(yaml, "load", load)
    cache = ConfigYamlCache(max_entries=2)
    for index in [0, 1, 0, 2, 1]:
        cache.read(paths[index], LOADER)
    assert len(calls) == 4
    oversized = ConfigYamlCache(max_file_bytes=1)
    oversized.read(paths[0], LOADER)
    oversized.read(paths[0], LOADER)
    assert len(calls) == 6


def test_loader_identity_is_part_of_the_cache_key(tmp_path):
    path = tmp_path / "params.yaml"
    path.write_text("settings: {language: !fixture synthetic}\n", encoding="utf-8")

    class FirstLoader(yaml.SafeLoader):
        pass

    class SecondLoader(yaml.SafeLoader):
        pass

    FirstLoader.add_constructor("!fixture", lambda loader, node: "ca")
    SecondLoader.add_constructor("!fixture", lambda loader, node: "fr")
    cache = ConfigYamlCache()
    assert cache.read(path, FirstLoader)["settings"]["language"] == "ca"
    assert cache.read(path, SecondLoader)["settings"]["language"] == "fr"
