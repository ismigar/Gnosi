"""A greeting can use assigned cloud skills without inspecting another profile."""
import asyncio
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

from backend.domains.agent.routes import workflow
from backend.services import agent_skill_catalog, principal_agent_migration
from backend.services.user_skill_store import UserSkillStore
from backend.utils import metadata_io


def test_greeting_waits_for_its_personal_skill_and_resolves_its_ancestry(tmp_path, monkeypatch):
    vault = tmp_path.resolve()
    tools = agent_skill_catalog.ToolCatalog()
    catalog = agent_skill_catalog.SkillCatalog(tools)
    catalog.register_core({"id": "core.writing", "name": "Writing"})
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
    monkeypatch.setattr(metadata_io, "_pending", {})
    monkeypatch.setattr(metadata_io, "_failed", {})
    monkeypatch.setattr(metadata_io, "is_cloud_placeholder", lambda path, _: path in pending)
    profile = {"id": "principal", "skill_ids": ["user.personal"]}
    monkeypatch.setattr(principal_agent_migration, "ensure_migrated", lambda: {"agents": [profile]})
    build = AsyncMock(return_value=(object(), {}))
    monkeypatch.setattr(workflow, "create_agent_workflow", build)

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

        monkeypatch.setattr(metadata_io, "_download", download)
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
        await workflow.get_agent_workflow(request, "principal", vault_path=vault, user_message="hola")

    asyncio.run(greeting())
    assert downloads == [assigned] and pending == {unrelated}
    runtime = build.await_args.kwargs["runtime_capabilities"]
    assert runtime.active_skill_ids == ("core.writing",)
    assert runtime.instructions == ("user.personal instructions",)
    assert runtime.tool_descriptors == ()
