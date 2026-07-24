"""Anti-data-loss guard in `save_page_md`: NEVER write a `.md` without `id`.

Regression test for the "mutilated frontmatter" bug. A note without `id` in the frontmatter gets indexed
by its file name (`metadata.get("id") or file_path.stem`), so all
UUID wikilinks pointing to it silently start returning 404.
See the red flag in `docs/dev_memory/directives/wikilink_interactions.md`.

The actual bug: `parse_frontmatter` returns `{}` when reading a truncated/online
-only OneDrive file; a reparent PATCH then adds only `parent_id` and
saves it → frontmatter with only `parent_id`. The guard in `save_page_md` recovers
the `id` from disk (frontmatter or regex) or generates a new one.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from backend.api.vault_routes import parse_frontmatter, save_page_md

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    """Minimal vault with `.gnosi/` so that `persist_sidecar_from` detects it."""
    (tmp_path / ".gnosi").mkdir()
    return tmp_path


def _read_fm(f: Path):
    md, _ = parse_frontmatter(f.read_text(encoding="utf-8"), f)
    md = md or {}
    return md.get("id"), md.get("title"), md.get("parent_id")


def test_normal_write_keeps_id(vault: Path):
    f = vault / "nota.md"
    save_page_md(
        f,
        {"id": "11111111-1111-4111-8111-111111111111", "title": "T", "parent_id": "P"},
        "cos",
    )
    _id, _title, _parent = _read_fm(f)
    assert _id == "11111111-1111-4111-8111-111111111111"
    assert _title == "T"
    assert _parent == "P"


def test_recovers_id_from_disk_when_caller_drops_it(vault: Path):
    """The EXACT case of the bug: reparent PATCH with metadata missing `id`."""
    f = vault / "nota.md"
    save_page_md(
        f,
        {"id": "22222222-2222-4222-8222-222222222222", "title": "Orig", "parent_id": "P1"},
        "cos",
    )
    # Buggy caller: metadata with only parent_id (id lost due to parse→{}).
    save_page_md(f, {"parent_id": "P2"}, "cos2")
    _id, _title, _parent = _read_fm(f)
    assert _id == "22222222-2222-4222-8222-222222222222"  # recovered from disk
    assert _parent == "P2"  # the requested change is applied
    assert _title  # non-empty title


def test_recovers_id_when_yaml_corrupt(vault: Path):
    """Frontmatter with invalid YAML but with an extractable `id:` (regex/fallback)."""
    f = vault / "nota.md"
    f.write_text(
        "---\nid: 33333333-3333-4333-8333-333333333333\n\tbroken: : :\n---\ncos antic\n",
        encoding="utf-8",
    )
    save_page_md(f, {"parent_id": "P3"}, "cos nou")
    _id, _title, _parent = _read_fm(f)
    assert _id == "33333333-3333-4333-8333-333333333333"
    assert _parent == "P3"


def test_generates_uuid_when_unrecoverable(vault: Path):
    """No recoverable `id` → generates a new uuid. NEVER writes without `id`."""
    f = vault / "nova.md"  # no existeix
    save_page_md(f, {"parent_id": "P4"}, "cos")
    _id, _title, _parent = _read_fm(f)
    assert _id and UUID_RE.match(_id)
    assert _parent == "P4"


def test_never_writes_empty_frontmatter(vault: Path):
    """Even with completely empty metadata, the `.md` never ends up without an `id`."""
    f = vault / "buida.md"
    save_page_md(f, {}, "cos")
    _id, _title, _parent = _read_fm(f)
    assert _id and UUID_RE.match(_id)
