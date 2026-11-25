"""Initial team admission reads only the assigned pairs under fresh, bounded grants."""
import asyncio
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.platform.files import coordinated, skill_worker, snapshots
from backend.services import agent_skill_catalog as catalogs, agent_team_runtime as teams
from backend.services.agent_catalog_snapshot import team_metadata_catalog
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import current_scope, execution_scope
from backend.services.agent_team_models import TEAM_SKILL
from backend.services.agent_team_skill_sources import bind_chat_skill_sources, chat_sources
from backend.services.user_skill_store import UserSkillStore
from backend.utils import metadata_io


@pytest.fixture
def roster(tmp_path, monkeypatch):
    vault = tmp_path.resolve()
    monkeypatch.setenv("GNOSI_DATA_DIR", str(vault / "app-data"))
    catalog = catalogs.SkillCatalog(catalogs.ToolCatalog())
    catalog.register_core({"id": TEAM_SKILL, "name": "Coordination"})
    monkeypatch.setattr(catalogs, "get_skill_catalog", lambda: catalog)
    store = UserSkillStore(vault)
    ids = [f"user.procedure-{i}" for i in range(10)]
    for key in [*ids, "user.ancestor", "user.other"]:
        metadata = {"derived_from": {"id": "user.ancestor"}} if key == ids[0] else {}
        store.create({"name": key, "metadata": metadata}, "First\r\nSegüent\rFinal", requested_id=key)
    members = [{"id": "first", "skill_ids": ids[:5]}, {"id": "second", "skill_ids": ids[3:]},
               {"id": "disabled", "skill_ids": ["user.other"], "enabled": False},
               {"id": "suspended", "skill_ids": ["user.other"], "plugin_suspended": True}]
    owner = {"id": "principal", "provider": "local", "model": "fixture", "skill_ids": [TEAM_SKILL],
             "team": {"enabled": True, "director_id": "principal", "members": [
                 {"agent_id": p["id"], "roles": ["worker"]} for p in members]}}
    # Classify only the disposable packages as allocated native sources. Individual reads
    # remain observable on all platforms, including when a grouped decision fails.
    stamp = metadata_io.allocated_vault_file_stamp
    monkeypatch.setattr(metadata_io, "is_native_vault_file", lambda path, *_: path == store.root)
    monkeypatch.setattr(metadata_io, "allocated_vault_file_stamp",
                        lambda path, **kw: stamp(path, **kw)._replace(native=True))
    config = {"agents": [owner, *members, {"id": "outsider", "skill_ids": ["user.other"]}]}
    scope = ExecutionScope(user_id="fixture", workspace_id="local", role="owner", vault_path=str(vault))
    individual = []
    original = metadata_io.vault_file_snapshot

    def observe(path, **kwargs):
        if path.is_relative_to(store.root):
            individual.append(path)
        return original(path, **kwargs)

    monkeypatch.setattr(metadata_io, "vault_file_snapshot", observe)

    def capture():
        with team_metadata_catalog(personal_phase="capture"):
            director = catalogs.resolve_agent_runtime(owner, vault_path=vault)
            teams.build_team_workflow(SimpleNamespace(agent_data=owner, resolved_runtime=director, ai_cfg=config),
                                      operation_mode=False, original="Hello")
            return {p.name: descriptor.instructions for (_, p), (_, descriptor) in chat_sources.get()._entries.items()}

    return scope, store, ids, individual, capture


def discover(scope, capture):
    async def run():
        with execution_scope(scope):
            async with asynccontextmanager(bind_chat_skill_sources)():
                return await asyncio.to_thread(capture)
    return asyncio.run(run())


def test_roster_batches_assigned_pairs_and_reads_discovered_ancestry_individually(roster, monkeypatch):
    scope, store, ids, individual, capture = roster
    groups = []

    def read(expected):
        groups.append(list(expected))
        return {path: path.read_bytes() for path in expected}

    monkeypatch.setattr(snapshots.reads, "read_skill_sources", read)
    found = discover(scope, capture)
    assert set(found) == {*ids, "user.ancestor"}
    assert set(found.values()) == {"First\nSegüent\nFinal"}
    assert [len(group) for group in groups] == [16, 4]
    assert {path.parent.name for group in groups for path in group} == set(ids)
    assert individual == [store.root / "user.ancestor" / leaf for leaf in ("skill.yaml", "SKILL.md")]
    path = store.root / ids[0] / "SKILL.md"
    path.write_text("Execution requires the current instructions")
    with execution_scope(scope):
        runtime = catalogs.resolve_agent_runtime({"skill_ids": [ids[0]]}, vault_path=store.vault_path)
    assert runtime.skills[0].descriptor.instructions == path.read_text()
    assert path in individual


@pytest.mark.parametrize("failure", ["changed", "denied", "invalid_descriptor"])
def test_unavailable_group_falls_back_with_the_original_per_package_behavior(roster, monkeypatch, failure):
    scope, store, ids, individual, capture = roster
    path = store.root / ids[0] / "SKILL.md"

    def reject(expected):
        if path in expected:
            if failure == "changed":
                path.write_text("Changed while waiting")
            if failure == "invalid_descriptor":
                path.with_name("skill.yaml").write_text("invalid: [yaml")
        return {}

    monkeypatch.setattr(snapshots.reads, "read_skill_sources", reject)
    if failure == "denied":
        original = metadata_io.read_vault_text_with_stat

        def denied(file, **kwargs):
            if file == path:
                raise metadata_io.MetadataUnavailable(path=path, reason="permission")
            return original(file, **kwargs)

        monkeypatch.setattr(metadata_io, "read_vault_text_with_stat", denied)
        with pytest.raises(metadata_io.MetadataUnavailable) as caught:
            discover(scope, capture)
        assert caught.value.reason == "permission"
    else:
        found = discover(scope, capture)
        if failure == "changed":
            assert found[ids[0]] == "Changed while waiting"
            assert path in individual
        else:
            assert set(found) == set(ids[1:])
            assert path not in individual
    assert all(file.parent.name != "user.other" for file in individual)


def test_a_second_identity_in_the_same_metadata_context_needs_its_own_grant(roster, monkeypatch):
    scope, store, ids, _, _ = roster
    other = scope.model_copy(update={"user_id": "another"})
    attempts = []

    def read(expected):
        attempts.append(current_scope().user_id)
        return {p: p.read_bytes() for p in expected} if current_scope() == scope else {}

    monkeypatch.setattr(snapshots.reads, "read_skill_sources", read)

    def denied(path, **kwargs):
        raise metadata_io.MetadataUnavailable(path=path, reason="permission")

    monkeypatch.setattr(metadata_io, "read_vault_text_with_stat", denied)
    profile = {"skill_ids": [ids[-1]]}

    def capture():
        with team_metadata_catalog(personal_phase="capture"):
            assert catalogs.resolve_agent_runtime(profile, vault_path=store.vault_path).skills
            with execution_scope(other), pytest.raises(metadata_io.MetadataUnavailable):
                catalogs.resolve_agent_runtime(profile, vault_path=store.vault_path)

    discover(scope, capture)
    assert attempts == [scope.user_id, other.user_id]


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS signed file coordinator")
def test_signed_worker_returns_exact_bytes_rejects_changes_and_reuses_the_process(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    build = tmp_path / "bin"
    subprocess.run(["node", "-e", 'require("./desktop/scripts/file-access-build.cjs").build(process.argv[1])',
                    str(build)], cwd=root, check=True)
    helper = build / "gnosi-file-access"
    subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(helper)], check=True)
    subprocess.run(["/usr/bin/codesign", "--verify", "--all-architectures", "--strict", str(helper)], check=True)
    monkeypatch.setenv("GNOSI_FILE_ACCESS_HELPER", str(helper))
    monkeypatch.setattr(coordinated, "_bundled_helper", lambda: helper)
    pool = skill_worker.SkillWorkers()
    monkeypatch.setattr(coordinated, "_skill_workers", pool)
    files = tmp_path.resolve() / ".gnosi/agent/skills"
    for i in range(8):
        package = files / f"user.demo-{i}"
        package.mkdir(parents=True)
        (package / "skill.yaml").write_bytes(f"id: {package.name}\r\n".encode())
        (package / "SKILL.md").write_bytes(bytes([i, 0, 255, 10]) * 37)
    paths = sorted(files.glob("*/*"))
    expected = {path: (*snapshots.revision(path.stat()), path.stat().st_flags) for path in paths}
    try:
        wanted = {path: path.read_bytes() for path in paths}
        assert snapshots.reads.read_skill_sources(expected) == wanted
        pid, = [worker.process.pid for worker in pool._children]
        paths[0].write_bytes(b"new")
        assert snapshots.reads.read_skill_sources(expected) == {}
        expected[paths[0]] = (*snapshots.revision(paths[0].stat()), paths[0].stat().st_flags)
        assert snapshots.reads.read_skill_sources(expected) == {**wanted, paths[0]: b"new"}
        assert [worker.process.pid for worker in pool._children] == [pid]
    finally:
        pool.close()
