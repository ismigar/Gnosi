"""A chat may share a procedure for discovery. Each execution reads its own grant."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from backend.services import agent_skill_catalog as catalog
from backend.services.agent_catalog_snapshot import team_metadata_catalog
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.services.agent_team_skill_sources import bind_chat_skill_sources
from backend.services.user_skill_store import UserSkillStore
from backend.utils import metadata_io


pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def chat(tmp_path, monkeypatch):
    vault = tmp_path.resolve()
    skills = catalog.SkillCatalog(catalog.ToolCatalog())
    monkeypatch.setattr(catalog, "get_skill_catalog", lambda: skills)
    attrs = {"name": "Original", "activation": "always"}
    store = UserSkillStore(vault)
    store.create(attrs, "First text", requested_id="user.draft")
    scope = ExecutionScope(user_id="anna", workspace_id="home", vault_path=str(vault), role="editor")
    reads = []
    snapshot = metadata_io.vault_file_snapshot

    def observed(path, **kwargs):
        reads.append(path.name)
        return snapshot(path, **kwargs)

    monkeypatch.setattr(metadata_io, "vault_file_snapshot", observed)

    def resolve(phase=None, *, at=vault):
        with team_metadata_catalog(personal_phase=phase):
            runtime = catalog.resolve_agent_runtime({"id": "worker", "skill_ids": ["user.draft"]}, vault_path=at)
        return runtime.skills[0].descriptor

    return scope, store.root / "user.draft", reads, resolve


async def test_chat_reuses_unchanged_pair_only_for_planning(chat):
    scope, package, reads, resolve = chat
    with execution_scope(scope):
        async with asynccontextmanager(bind_chat_skill_sources)():
            captured = resolve("capture")
            captured.metadata["ignored"] = True
            assert reads == ["skill.yaml", "SKILL.md"]
            planned = resolve("planning")
            assert planned.instructions == "First text" and "ignored" not in planned.metadata
            assert reads == ["skill.yaml", "SKILL.md"]
            (package / "SKILL.md").write_text("Fresh text")
            assert resolve().instructions == "Fresh text"
            assert len(reads) == 4
        async with asynccontextmanager(bind_chat_skill_sources)():
            assert resolve("planning").instructions == "Fresh text"
            assert len(reads) == 6


@pytest.mark.parametrize("change", ["instructions", "descriptor", "scope", "placeholder", "symlink", "missing"])
async def test_planning_checks_both_sources_and_scope(chat, change, monkeypatch):
    scope, package, reads, resolve = chat
    file = package / "SKILL.md"
    with execution_scope(scope):
        async with asynccontextmanager(bind_chat_skill_sources)():
            resolve("capture")
            reads.clear()
            if change == "instructions":
                stamp = file.stat()
                file.write_text("Other text")
                os.utime(file, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
            elif change == "descriptor":
                file = package / "skill.yaml"
                other = package / "edited.yaml"
                other.write_text(file.read_text().replace("Original", "Modified"))
                other.replace(file)
            elif change == "scope":
                scope = scope.model_copy(update={"user_id": "joan"})
            elif change == "placeholder":
                monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda path, _: path == file)
                snapshot = metadata_io.vault_file_snapshot

                def unavailable(path, **kwargs):
                    if path == file:
                        raise metadata_io.MetadataUnavailable(path=path, reason="pending")
                    return snapshot(path, **kwargs)

                monkeypatch.setattr(metadata_io, "vault_file_snapshot", unavailable)
            elif change == "symlink":
                new = package / "other.md"
                file.rename(new)
                file.symlink_to(new)
            else:
                file.unlink()
            with execution_scope(scope):
                if change in {"symlink", "missing"}:
                    with team_metadata_catalog(personal_phase="planning"):
                        result = catalog.resolve_agent_runtime({"skill_ids": ["user.draft"]}, vault_path=Path(scope.vault_path))
                    assert result.missing_skill_ids == ("user.draft",)
                elif change == "placeholder":
                    with pytest.raises(metadata_io.MetadataUnavailable) as caught:
                        resolve("planning")
                    assert caught.value.reason == "pending"
                else:
                    value = resolve("planning")
                    assert reads == ["skill.yaml", "SKILL.md"]
                    assert value.instructions == ("Other text" if change == "instructions" else "First text")
                    assert value.name == ("Modified" if change == "descriptor" else "Original")


async def test_capture_does_not_attribute_changed_source_to_previous_bytes(chat, monkeypatch):
    scope, package, reads, resolve = chat
    read = metadata_io.read_vault_text_with_stat

    def change_during_read(path, **kwargs):
        text, info = read(path, **kwargs)
        if path.name == "SKILL.md":
            path.write_text("Revised")
        return text, info

    with execution_scope(scope):
        async with asynccontextmanager(bind_chat_skill_sources)():
            monkeypatch.setattr(metadata_io, "read_vault_text_with_stat", change_during_read)
            assert resolve("capture").instructions == "First text"
            assert resolve("planning").instructions == "Revised"
            assert reads == ["skill.yaml", "SKILL.md"] * 2


async def test_alias_and_canonical_vault_share_only_the_authenticated_source(chat, tmp_path):
    scope, _, reads, resolve = chat
    alias = tmp_path / "vault-alias"
    alias.symlink_to(scope.vault_path, target_is_directory=True)
    with execution_scope(scope):
        async with asynccontextmanager(bind_chat_skill_sources)():
            resolve("capture", at=alias)
            assert resolve("planning").instructions == "First text"
            assert reads == ["skill.yaml", "SKILL.md"]


async def test_two_vaults_with_the_same_skill_id_keep_their_own_procedure(chat, tmp_path):
    scope, _, reads, resolve = chat
    other_vault = (tmp_path / "other-vault").resolve()
    UserSkillStore(other_vault).create({"name": "Elsewhere"}, "Other vault content", requested_id="user.draft")
    reads.clear()
    with execution_scope(scope):
        async with asynccontextmanager(bind_chat_skill_sources)():
            resolve("capture")
            with execution_scope(scope.model_copy(update={"vault_path": str(other_vault)})):
                assert resolve("planning", at=other_vault).instructions == "Other vault content"
            assert reads == ["skill.yaml", "SKILL.md"] * 2
