"""Synthetic disk and mutation contracts for open translation metadata."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.domains.vault.pages.state import PageState
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.translation import lookup, metadata_io
from backend.services.translation_helpers import canonicalize_id, find_translations_of


def metadata_dependencies(metadata: RegistryData, trace: list[object]) -> metadata_io.TranslationMetadataDependencies:
    return metadata_io.TranslationMetadataDependencies(
        parse_frontmatter=lambda _raw, _path: (metadata, "body"),
        save_page=lambda path, value, body: trace.append(("save", path, value, body)),
        refresh_page_index=lambda path, value, body: trace.append(("refresh", path, value, body)),
        invalidate_pages=lambda: trace.append("invalidate"),
        effect_write_key=lambda _metadata, _prop: "status",
        logger=logging.getLogger(__name__),
    )


def test_write_keeps_unknown_keys_identity_and_order(tmp_path: Path) -> None:
    path = tmp_path / "page.md"
    path.write_text("synthetic", encoding="utf-8")
    opaque = object()
    metadata: RegistryData = {13: opaque}
    trace: list[object] = []
    deps = metadata_dependencies(metadata, trace)
    assert metadata_io.write_metadata_key_on_disk("id", path, "status", opaque, deps)
    assert metadata[13] is opaque and metadata["status"] is opaque
    assert trace == [("save", path, metadata, "body"), ("refresh", path, metadata, "body"), "invalidate"]
    assert isinstance(trace[0], tuple) and trace[0][2] is metadata
    trace.clear()
    assert not metadata_io.write_metadata_key_on_disk("id", path, "status", opaque, deps)
    assert not trace


@pytest.mark.parametrize("failure", ["save", "refresh", "invalidate"])
def test_write_failure_boundaries(tmp_path: Path, failure: str) -> None:
    path = tmp_path / "page.md"
    path.write_text("synthetic", encoding="utf-8")
    trace: list[object] = []
    metadata: RegistryData = {}
    deps = metadata_dependencies(metadata, trace)

    def fail(*_args: object) -> None:
        trace.append(failure)
        raise OSError(failure)

    if failure == "save":
        deps = replace(deps, save_page=fail)
        assert not metadata_io.write_metadata_key_on_disk("id", path, "key", 7, deps)
        assert trace == ["save"]
    else:
        deps = replace(deps, refresh_page_index=fail) if failure == "refresh" else replace(deps, invalidate_pages=fail)
        with pytest.raises(OSError, match=failure):
            metadata_io.write_metadata_key_on_disk("id", path, "key", 7, deps)
    assert metadata["key"] == 7


@pytest.mark.parametrize("flag,changed", [(True, False), (1, True), (False, True)])
def test_stale_true_is_identity_check_not_truthiness(tmp_path: Path, flag: object, changed: bool) -> None:
    path = tmp_path / "page.md"
    path.write_text("synthetic", encoding="utf-8")
    metadata: RegistryData = {"translation_stale": flag, 9: "keep"}
    trace: list[object] = []
    deps = metadata_dependencies(metadata, trace)
    opaque = object()
    assert metadata_io.set_translation_stale_on_disk("id", path, ({7: "prop"}, opaque), deps) is changed
    assert metadata["translation_stale"] is True
    if changed:
        assert metadata["status"] is opaque
    else:
        assert not trace and "status" not in metadata


def test_recovery_sorted_first_wins_despite_index_failure(tmp_path: Path) -> None:
    for name in ("z.md", "a.md", "other.md"):
        (tmp_path / name).write_text("synthetic", encoding="utf-8")
    raw_id: list[object] = ["opaque"]
    metadata: RegistryData = {"id": raw_id, "translation_origin_id": "A-B", "translation_lang": " ES ", 4: object()}
    trace: list[str] = []

    async def materialize(path: Path, _label: str) -> None:
        trace.append(path.name)

    def build(*_args: object) -> dict[str, object]:
        raise OSError("synthetic index failure")

    deps = lookup.TranslationLookupDependencies(
        page_snapshot=lambda: [], find_translations=find_translations_of,
        canonicalize_id=canonicalize_id, materialize=materialize,
        read_frontmatter_partial=lambda _path: (metadata, "body"),
        active_vault_path=lambda: tmp_path, build_page_cache_entry=build,
        bump_page_index_version=lambda _key: None, invalidate_pages=lambda: None,
        page_state=PageState(), logger=logging.getLogger(__name__),
    )
    recovered = asyncio.run(lookup.recover_translations_from_disk("ab", tmp_path, [], deps))
    assert trace == ["a.md", "other.md", "z.md"]
    assert set(recovered) == {"es"}
    page = recovered["es"]
    assert isinstance(page, SimpleNamespace) and page.id is raw_id and page.metadata is metadata


def test_snapshot_callback_is_captured_before_snapshot_evaluation() -> None:
    original: dict[str, object] = {"es": object()}
    deps = lookup.TranslationLookupDependencies(
        page_snapshot=lambda: [], find_translations=lambda _id, _pages: original,
        canonicalize_id=canonicalize_id, materialize=_noop_materialize,
        read_frontmatter_partial=lambda _path: ({}, ""),
        active_vault_path=lambda: None, build_page_cache_entry=lambda _p, _s: {},
        bump_page_index_version=lambda _key: None, invalidate_pages=lambda: None,
        page_state=PageState(), logger=logging.getLogger(__name__),
    )

    def snapshot() -> list[object]:
        object.__setattr__(deps, "find_translations", lambda _id, _pages: {})
        return []

    object.__setattr__(deps, "page_snapshot", snapshot)
    assert asyncio.run(lookup.existing_translations("ab", deps)) is original


async def _noop_materialize(_path: Path, _label: str) -> None:
    return None
