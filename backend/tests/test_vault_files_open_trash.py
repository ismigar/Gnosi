"""Synthetic characterization of recoverable trash and opaque sidecar values."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.trash import repository


def _parse(content: str, path: Path | None) -> tuple[PageMetadata, str]:
    return {}, content


def _write(path: Path, obj: object, **dumps_kwargs: object) -> None:
    assert dumps_kwargs == {"indent": 2}
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def _repository(root: Path) -> repository.TrashRepository:
    return repository.TrashRepository(
        root, retention_days=90, parse_frontmatter=_parse, write_json=_write
    )


def _entry(root: Path, page_id: str, sidecar: object) -> Path:
    path = root / ".trash" / page_id
    path.mkdir(parents=True)
    (path / "_trash.json").write_text(json.dumps(sidecar), encoding="utf-8")
    return path


@pytest.mark.parametrize("page_id", ["", " ", ".", "..", "a/b", "a\\b", "a\x00b"])
def test_unsafe_id_does_not_create_trash(tmp_path: Path, page_id: str) -> None:
    with pytest.raises(ValueError) as error:
        _repository(tmp_path).entry_dir(page_id)
    assert str(error.value) == f"Unsafe trash entry id: {page_id!r}"
    assert not (tmp_path / ".trash").exists()


def test_move_preserves_opaque_metadata_and_writer_order(tmp_path: Path) -> None:
    source = tmp_path / "sample.json"
    source.write_text("synthetic document", encoding="utf-8")
    parent = object()
    table: list[object] = [object()]
    metadata: PageMetadata = {"title": 17, "table_id": table, "parent_id": parent, 23: object()}
    captured: list[object] = []

    def parse(content: str, path: Path | None) -> tuple[PageMetadata, str]:
        assert content == "synthetic document" and path == source
        assert (tmp_path / ".trash" / "sample").is_dir()
        return metadata, content

    def write(path: Path, obj: object, **kwargs: object) -> None:
        assert path == tmp_path / ".trash" / "sample" / "_trash.json"
        assert kwargs == {"indent": 2}
        assert not source.exists()
        assert (path.parent / "page.md").read_text() == "synthetic document"
        captured.append(obj)

    repo = repository.TrashRepository(
        tmp_path, retention_days=90, parse_frontmatter=parse, write_json=write
    )
    result = repo.move_page("sample", source)
    assert captured[0] is result
    assert set(result) == {
        "id",
        "title",
        "deleted_at",
        "original_path",
        "original_parent_id",
        "table_id",
        "size_bytes",
        "extension",
    }
    assert result["original_parent_id"] is parent and result["table_id"] is table
    assert result["title"] == "17" and result["extension"] == ".json"
    assert result["size_bytes"] == len("synthetic document")
    assert result["original_path"] == "sample.json"
    assert datetime.fromisoformat(str(result["deleted_at"])).tzinfo is not None


def test_idempotent_move_returns_loaded_dictionary_without_copy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    slot = _entry(tmp_path, "sample", {})
    key = object()
    value = object()
    loaded: dict[object, object] = {key: value, "title": [False, 3]}
    monkeypatch.setattr(json, "loads", lambda text: loaded)
    result = _repository(tmp_path).move_page("sample", tmp_path / "missing.md")
    assert result is loaded and result[key] is value
    assert list(slot.iterdir()) == [slot / "_trash.json"]


def test_new_source_replaces_stale_slot_and_roundtrips(tmp_path: Path) -> None:
    slot = _entry(tmp_path, "sample", {"title": "old"})
    (slot / "stale.md").write_text("old", encoding="utf-8")
    source = tmp_path / "sample.md"
    source.write_text("replacement", encoding="utf-8")
    repo = _repository(tmp_path)
    deleted = repo.move_page("sample", source)
    assert not (slot / "stale.md").exists()
    assert not source.exists()
    restored = repo.restore_page("sample")
    assert restored == {**deleted, "restored_path": "sample.md"}
    assert source.read_text() == "replacement"
    assert not slot.exists()


@pytest.mark.parametrize("error_type", [OSError, ValueError, TypeError])
def test_frontmatter_failure_keeps_recoverable_move(
    tmp_path: Path, error_type: type[Exception]
) -> None:
    def parse(content: str, path: Path | None) -> tuple[PageMetadata, str]:
        raise error_type("synthetic parse failure")

    source = tmp_path / "sample"
    source.write_text("body", encoding="utf-8")
    repo = repository.TrashRepository(
        tmp_path, retention_days=90, parse_frontmatter=parse, write_json=_write
    )
    result = repo.move_page("sample", source)
    assert result["title"] == ""
    assert result["table_id"] is None and result["original_parent_id"] is None
    assert result["extension"] == ".md"
    assert (repo.entry_dir("sample") / "page.md").read_text() == "body"


def test_outside_source_is_never_moved(tmp_path: Path) -> None:
    root = tmp_path / "vault"
    root.mkdir()
    source = tmp_path / "outside.md"
    source.write_text("outside", encoding="utf-8")
    with pytest.raises(RuntimeError) as error:
        _repository(root).move_page("sample", source)
    assert str(error.value) == f"Page file {source} is outside the Vault root {root}"
    assert source.read_text() == "outside"


@pytest.mark.parametrize("original_path", ["../escape.md", "../../escape.md"])
def test_restore_containment_keeps_trash_intact(tmp_path: Path, original_path: str) -> None:
    slot = _entry(tmp_path, "sample", {"original_path": original_path})
    (slot / "page.md").write_text("recoverable", encoding="utf-8")
    with pytest.raises(PermissionError) as error:
        _repository(tmp_path).restore_page("sample")
    assert str(error.value) == f"original_path escapes Vault: {original_path}"
    assert (slot / "page.md").read_text() == "recoverable"
    assert (slot / "_trash.json").exists()


def test_restore_symlink_escape_keeps_trash_intact(tmp_path: Path) -> None:
    root = tmp_path / "vault"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "shortcut").symlink_to(outside, target_is_directory=True)
    slot = _entry(root, "sample", {"original_path": "shortcut/page.md"})
    (slot / "page.md").write_text("recoverable", encoding="utf-8")
    with pytest.raises(PermissionError, match="original_path escapes Vault"):
        _repository(root).restore_page("sample")
    assert not (outside / "page.md").exists()
    assert (slot / "page.md").is_file()


def test_restore_conflict_precedes_missing_source(tmp_path: Path) -> None:
    slot = _entry(tmp_path, "sample", {"original_path": "existing.md"})
    target = tmp_path / "existing.md"
    target.write_text("unchanged", encoding="utf-8")
    with pytest.raises(FileExistsError) as error:
        _repository(tmp_path).restore_page("sample")
    assert str(error.value) == str(target)
    assert target.read_text() == "unchanged" and slot.exists()


@pytest.mark.parametrize("loaded", [None, [], [1], "metadata", 19])
def test_restore_rejects_non_dictionary_sidecar(tmp_path: Path, loaded: object) -> None:
    slot = _entry(tmp_path, "sample", loaded)
    with pytest.raises(ValueError) as error:
        _repository(tmp_path).restore_page("sample")
    assert str(error.value) == "Invalid trash sidecar for sample"
    assert slot.exists()


def test_restore_copy_preserves_nonstring_keys_and_opaque_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    slot = _entry(tmp_path, "sample", {})
    (slot / "fallback.json").write_text("fallback body", encoding="utf-8")
    key = object()
    value = object()
    loaded: dict[object, object] = {key: value, "original_path": 0, "title": [2]}
    monkeypatch.setattr(json, "loads", lambda text: loaded)
    result = _repository(tmp_path).restore_page("sample")
    assert result is not loaded and result[key] is value
    assert result["title"] is loaded["title"]
    assert result["restored_path"] == "sample.md"
    assert "restored_path" not in loaded
    assert (tmp_path / "sample.md").read_text() == "fallback body"


def test_restore_missing_payload_retains_created_parent(tmp_path: Path) -> None:
    slot = _entry(tmp_path, "sample", {"original_path": "nested/sample.md"})
    (slot / "not-a-page.txt").write_text("untouched", encoding="utf-8")
    with pytest.raises(FileNotFoundError) as error:
        _repository(tmp_path).restore_page("sample")
    assert str(error.value) == f"page.md missing in {slot}"
    assert (tmp_path / "nested").is_dir()
    assert (slot / "not-a-page.txt").read_text() == "untouched"


def test_list_preserves_extensions_fallbacks_and_retention(tmp_path: Path) -> None:
    now = datetime.now(tz=timezone.utc)
    old = (now - timedelta(days=95)).isoformat()
    future = (now + timedelta(days=3)).isoformat()
    _entry(tmp_path, "old", {"id": "old", "deleted_at": old, "extension": {"a": [1]}})
    _entry(tmp_path, "future", {"id": "future", "deleted_at": future})
    _entry(tmp_path, "bad-date", {"id": "bad-date", "deleted_at": "not-a-date"})
    _entry(tmp_path, "non-dict", [])
    corrupt = _entry(tmp_path, "corrupt", {})
    (corrupt / "_trash.json").write_text("{", encoding="utf-8")
    (tmp_path / ".trash" / "missing").mkdir()
    (tmp_path / ".trash" / "ignored.txt").write_text("ignored", encoding="utf-8")
    result = _repository(tmp_path).list_entries()
    assert len(result) == 6
    assert [str(item.get("deleted_at") or "") for item in result] == sorted(
        ["not-a-date", future, old, "", "", ""], reverse=True
    )
    by_id = {str(item.get("id")): item for item in result}
    assert by_id["old"]["days_remaining"] == 0
    assert by_id["old"]["extension"] == {"a": [1]}
    assert by_id["future"]["days_remaining"] == 93
    assert by_id["bad-date"]["days_remaining"] is None
    assert by_id["None"] == {"days_remaining": None}
    assert by_id["corrupt"]["title"] == "(corrupt)"
    assert by_id["missing"]["title"] == "(sense metadades)"


def test_list_copies_envelope_without_rewriting_keys_or_values(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _entry(tmp_path, "sample", {})
    key = object()
    value = object()
    loaded: dict[object, object] = {key: value, "deleted_at": None}
    monkeypatch.setattr(json, "loads", lambda text: loaded)
    result = _repository(tmp_path).list_entries()[0]
    assert result is not loaded and result[key] is value
    assert result["days_remaining"] is None and "days_remaining" not in loaded
