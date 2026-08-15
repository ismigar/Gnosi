"""Restoring a page must land in the in-memory page index even when the vault
root path goes through a symlink (e.g. macOS /tmp -> /private/tmp).

Regression: `restore_page` called `_add_page_to_index_cache(vault_root.resolve()
/ restored_rel)`. `resolve()` canonicalizes the symlink, so inside
`_build_page_cache_entry` the `relative_to(get_p("VAULT"))` against the
UNRESOLVED root raised ValueError — swallowed at debug level — and the restored
page silently stayed out of the index until the next full rescan.

Hermetic: no live backend, vault in tmp_path behind a symlink.
"""
import asyncio
from pathlib import Path

import pytest

import backend.api.vault_routes as vr
from backend.services.context_vars import active_vault_path

PID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


class _NoopResolver:
    """Stand-in for the global PathResolver: keeps the test hermetic."""

    def add_file(self, *a, **k):
        pass

    def remove_file(self, *a, **k):
        pass


async def _noop_materialize(*a, **k):
    return None


@pytest.fixture()
def symlinked_vault(monkeypatch, tmp_path):
    real = tmp_path / "real_vault"
    (real / "Wiki").mkdir(parents=True)
    link = tmp_path / "vault_link"
    link.symlink_to(real, target_is_directory=True)
    # Premise of the regression: the configured root is NOT canonical.
    assert link.resolve() != link

    monkeypatch.setattr(vr, "get_p", lambda key: link)
    monkeypatch.setattr(vr, "path_resolver", _NoopResolver())
    monkeypatch.setattr(vr, "_page_index_entries", {})
    monkeypatch.setattr(vr, "_page_id_to_path", {})
    # OneDrive warmup is irrelevant for a local tmp vault.
    monkeypatch.setattr(vr, "_materialize_if_online_only", _noop_materialize)

    page = link / "Wiki" / f"{PID}.md"
    page.write_text(
        f"---\nid: {PID}\ntitle: Pàgina de prova\n---\ncos de prova\n",
        encoding="utf-8",
    )

    token = active_vault_path.set(link)
    yield {"link": link, "page": page}
    active_vault_path.reset(token)


def test_restore_reindexes_page_under_symlinked_vault(symlinked_vault):
    link, page = symlinked_vault["link"], symlinked_vault["page"]

    vr._move_page_to_trash(PID, page)
    assert not page.exists(), "soft-delete must move the file to .trash/"

    res = asyncio.run(vr.restore_page(PID))
    assert res["status"] == "restored"
    assert page.exists(), "restore must put the file back at original_path"

    # The point of the regression test: the restored page is in the index
    # (keyed by the UNRESOLVED vault path), without waiting for a full rescan.
    entries = vr._page_index_entries.get(str(link), {})
    assert str(page) in entries, "restored page missing from the page index"
    assert entries[str(page)]["id"] == PID
    assert vr._page_id_to_path.get(str(link), {}).get(PID) == str(page)


def test_build_entry_tolerates_resolved_path(symlinked_vault):
    """Defense-in-depth: even if a caller passes a resolve()d file path while
    get_p("VAULT") stays unresolved, the entry must still be built (fallback
    resolves both sides) instead of raising ValueError on relative_to()."""
    resolved = symlinked_vault["page"].resolve()
    entry = vr._build_page_cache_entry(resolved, resolved.stat())
    assert entry["id"] == PID
    assert entry["title"] == "Pàgina de prova"
