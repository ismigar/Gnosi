"""A greeting can use assigned cloud skills without inspecting another profile."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.domains.agent.routes import workflow
from backend.services import agent_skill_catalog, agent_team_runtime, principal_agent_migration
from backend.services.context_vars import active_vault_path
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.services.agent_team_models import TEAM_SKILL
from backend.services.user_skill_store import UserSkillStore
from backend.tests.cloud_file_fixtures import install_coordinated_reader
from backend.utils import metadata_io


@pytest.mark.parametrize("team_member", [False, True], ids=["principal", "team-member"])
def test_greeting_waits_for_its_personal_skill_and_resolves_its_ancestry(tmp_path, monkeypatch, team_member):
    vault = tmp_path.resolve()
    tools = agent_skill_catalog.ToolCatalog()
    catalog = agent_skill_catalog.SkillCatalog(tools)
    catalog.register_core({"id": "core.writing", "name": "Writing"})
    catalog.register_core({"id": TEAM_SKILL, "name": "Coordination"})
    monkeypatch.setattr(agent_skill_catalog, "get_skill_catalog", lambda: catalog)
    monkeypatch.setattr(agent_skill_catalog, "get_tool_catalog", lambda: tools)
    store = UserSkillStore(vault)
    for identifier, parent in (("user.base", "core.writing"), ("user.personal", "user.base")):
        store.create({"name": identifier, "metadata": {"derived_from": {"id": parent}}},
                     identifier + " instructions", requested_id=identifier)
    store.create({"name": "Unassigned"}, "Unrelated instructions", requested_id="user.other")
    assigned = store.root / "user.personal" / "SKILL.md"
    unrelated = store.root / "user.other" / "skill.yaml"
    pending = {assigned, unrelated}
    downloads = []
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda path, _: path in pending)
    owner = {"id": "principal", "skill_ids": ["user.personal"]}
    config = {"active_agent_id": "principal", "agents": [owner]}
    build = AsyncMock(return_value=(object(), {}))
    if team_member:
        owner.update(skill_ids=[TEAM_SKILL], team={"enabled": True, "director_id": "principal",
                                                 "members": [{"agent_id": "worker"}]})
        config["agents"].append({"id": "worker", "skill_ids": ["user.personal"]})
        monkeypatch.setattr(agent_team_runtime, "_config", lambda: config)
    else:
        monkeypatch.setattr(workflow, "create_agent_workflow", build)
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: config)

    async def greeting():
        loop = asyncio.get_running_loop()

        def download(path):
            downloads.append(path)
            available = threading.Event()
            loop.call_soon_threadsafe(available.set)
            if path != assigned or not available.wait(timeout=2):
                return False
            pending.remove(path)
            return True

        install_coordinated_reader(monkeypatch, download)
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
        scope = ExecutionScope(user_id="u", workspace_id="w", role="owner", vault_path=str(vault))
        with execution_scope(scope, origin="chat"):
            return await workflow.get_agent_workflow(request, "principal", vault_path=vault, user_message="hola")

    graph, selection = asyncio.run(greeting())
    assert graph is not None
    assert downloads == [assigned] and pending == {unrelated}
    if team_member:
        assert selection["mode"] == "team" and selection["tools"] == []
    else:
        runtime = build.await_args.kwargs["runtime_capabilities"]
        assert runtime.active_skill_ids == ("core.writing",)
        assert runtime.instructions == ("user.personal instructions",)
        assert runtime.tool_descriptors == ()


def test_a_local_profile_can_read_while_another_downloads(tmp_path, monkeypatch):
    store = UserSkillStore(tmp_path.resolve())
    for name in ("remote", "local"):
        store.create({"name": name}, name, requested_id="user." + name)
    pending = {store.root / "user.remote" / "SKILL.md"}
    started, release = threading.Event(), threading.Event()

    def download(path):
        started.set()
        if not release.wait(8):
            return False
        pending.remove(path)
        return True

    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda path, _: path in pending)
    install_coordinated_reader(monkeypatch, download)
    with ThreadPoolExecutor(max_workers=2) as pool:
        remote = pool.submit(store.load_referenced, ["user.remote"], {})
        try:
            assert started.wait(3)
            local = pool.submit(store.load_referenced, ["user.local"], {})
            assert local.result(timeout=3)[0].instructions == "local"
        finally:
            release.set()
        assert remote.result(timeout=3)[0].instructions == "remote"


def test_known_cloud_assignments_overlap_and_preserve_ancestry_order(tmp_path, monkeypatch):
    vault = tmp_path.resolve()
    store = UserSkillStore(vault)
    for name in ("first", "parent", "second", "unassigned"):
        metadata = {"derived_from": {"id": "user.parent"}} if name == "second" else {}
        store.create({"name": name, "metadata": metadata}, name, requested_id="user." + name)
    monkeypatch.setattr(metadata_io, "is_native_vault_file", lambda path, *_: path == store.root)
    barrier = threading.Barrier(2, timeout=3)
    original = store.load
    reads = []

    def read(identifier):
        assert active_vault_path.get() == vault
        reads.append(identifier)
        if identifier in {"user.first", "user.second"}:
            barrier.wait()
        return original(identifier)

    monkeypatch.setattr(store, "load", read)
    token = active_vault_path.set(vault)
    try:
        assigned = ["user.first", "user.second", "user.second"]
        resolved = store.load_referenced(assigned, {})
        assert [skill.id for skill in resolved] == ["user.second", "user.parent", "user.first"]
        assert sorted(reads) == ["user.first", "user.parent", "user.second"]
        (store.root / "user.second" / "SKILL.md").write_text("revised")
        assert store.load_referenced(assigned, {})[0].instructions == "revised"
    finally:
        active_vault_path.reset(token)


def test_synchronous_cloud_resolution_on_the_event_loop_keeps_the_pending_handoff(tmp_path, monkeypatch):
    store = UserSkillStore(tmp_path)
    monkeypatch.setattr(metadata_io, "is_native_vault_file", lambda *_: True)

    async def read():
        loop = asyncio.get_running_loop()

        def pending(identifier):
            assert asyncio.get_running_loop() is loop
            raise metadata_io.MetadataUnavailable(path=store.root / identifier, reason="pending")

        monkeypatch.setattr(store, "load", pending)
        with pytest.raises(metadata_io.MetadataUnavailable) as error:
            store.load_referenced(["user.first", "user.second"], {})
        assert error.value.reason == "pending"

    asyncio.run(read())
