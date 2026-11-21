"""Team discovery shares one governed inventory while execution reopens the catalog."""
from collections import Counter
from types import SimpleNamespace

from backend.agent import model_router
from backend.services import agent_skill_catalog as catalogs, agent_team_runtime as teams
from backend.services.agent_execution_models import ExecutionScope
from backend.services.agent_execution_scope import execution_scope
from backend.services.agent_team_models import TEAM_SKILL
from backend.services.agent_team_routing import planning_catalog
from backend.services.user_skill_store import UserSkillStore


def test_each_metadata_phase_reads_shared_assignments_once_and_execution_rechecks(tmp_path, monkeypatch):
    tools = catalogs.ToolCatalog()
    skills = catalogs.SkillCatalog(tools)
    monkeypatch.setattr(catalogs, "get_skill_catalog", lambda: skills)
    monkeypatch.setattr(catalogs, "get_tool_catalog", lambda: tools)
    skills.register_core({"id": TEAM_SKILL, "name": "Coordination"})
    skills.register_core({"id": "core.writing", "name": "Writing"})
    calls = Counter()
    enabled = True

    def lookup(query: str = "") -> str:
        return query

    def plugin_tools():
        calls["tools"] += 1
        return [{"id": "plugin.lookup.search", "name": "Search", "handler": lookup,
                 "status": "available" if enabled else "suspended"}]

    def plugin_skills():
        calls["skills"] += 1
        return [{"id": "plugin.lookup.sources", "name": "Find sources",
                 "tool_ids": ["plugin.lookup.search"]}]

    tools.register_plugin_provider("lookup", plugin_tools)
    skills.register_plugin_provider("lookup", plugin_skills)
    store = UserSkillStore(tmp_path)
    for identifier, parent in (("user.base", "core.writing"), ("user.personal", "user.base")):
        store.create({"name": identifier, "metadata": {"derived_from": {"id": parent}}},
                     identifier + " instructions", requested_id=identifier)
    personal = ["user.personal", "plugin.lookup.sources"]
    owner = {"id": "principal", "provider": "local", "model": "model", "skill_ids": [TEAM_SKILL],
             "team": {"enabled": True, "director_id": "principal", "members": [
                 {"agent_id": name, "roles": ["worker"]} for name in ("first", "second", "missing", "disabled", "suspended")]}}
    profiles = [
        {"provider": "local", "model": "model", **data} for data in (
            {"id": "first", "skill_ids": personal},
            {"id": "second", "skill_ids": personal},
            {"id": "missing", "skill_ids": ["user.missing"]},
            {"id": "disabled", "skill_ids": ["user.elsewhere"], "enabled": False},
            {"id": "suspended", "skill_ids": ["user.elsewhere"], "plugin_suspended": True},
            {"id": "outsider", "skill_ids": ["user.elsewhere"]},
        )
    ]
    config = {"agents": [owner, *profiles], "providers": {"local": {}}}
    monkeypatch.setattr(teams, "_config", lambda: config)
    monkeypatch.setattr(model_router, "budget_status", lambda: {"over_cap": False})
    monkeypatch.setattr(model_router, "load_registry", lambda: [
        {"provider": "local", "model_id": "model", "enabled": True, "context_window": 32000}])
    load = UserSkillStore.load

    def counted_load(self, identifier):
        calls[identifier] += 1
        assert identifier != "user.elsewhere"
        return load(self, identifier)

    monkeypatch.setattr(UserSkillStore, "load", counted_load)
    scope = ExecutionScope(user_id="fixture", workspace_id="local", role="owner", vault_path=str(tmp_path))
    with execution_scope(scope, origin="chat"):
        director = catalogs.resolve_agent_runtime(owner, vault_path=tmp_path)
        profile = SimpleNamespace(agent_data=owner, resolved_runtime=director)
        calls.clear()
        graph, selection = teams.build_team_workflow(profile, operation_mode=False, original="Hola")
        expected_reads = {"tools": 1, "skills": 1, "user.personal": 1, "user.base": 1, "user.missing": 1}
        assert graph is not None and calls == expected_reads
        assert selection["tools"][0]["skill_ids"] == ["plugin.lookup.sources"]

        observed = {}
        resolve = teams._runtime

        def capture(member, scope, skill_ids=None):
            runtime = resolve(member, scope, skill_ids)
            observed[member["id"]] = runtime
            return runtime

        monkeypatch.setattr(teams, "_runtime", capture)
        calls.clear()
        planned = planning_catalog(owner, scope, "Use the current sources", include_owner=True)
        assert calls == expected_reads
        assert observed["principal"].catalog_revision == director.catalog_revision
        assert [(row["id"], row["available"]) for row in planned] == [
            ("principal", True), ("first", True), ("second", True), ("missing", False)]
        assert planned[-1]["missing_skill_ids"] == ["user.missing"]
        assert planned[1]["capabilities"] == planned[2]["capabilities"]
        assert [(item["id"], item["canonical_id"]) for item in planned[1]["capabilities"]] == [
            ("user.personal", "core.writing"), ("plugin.lookup.sources", "plugin.lookup.sources")]
        assert planned[1]["tools"] == [{"id": "plugin.lookup.search", "name": "Search",
                                       "call_name": "", "effects": ["read"]}]

        # The same profile and assignments produce the established revision for this vault.
        runtime = catalogs.resolve_agent_runtime(profiles[0], vault_path=tmp_path)
        expected = skills.entries_revision(skills.list_entries(tmp_path, profile_skill_ids=personal))
        assert runtime.catalog_revision == observed["first"].catalog_revision == expected
        assert expected != observed["principal"].catalog_revision
        assert runtime.instructions == ("user.personal instructions",)
        assert runtime.tools == (lookup,)

        enabled = False
        current = catalogs.resolve_agent_runtime(profiles[0], vault_path=tmp_path)
        assert current.catalog_revision != runtime.catalog_revision
        assert current.active_skill_ids == ("core.writing",)
        assert current.tools == ()
        assert current.skills[1].missing_tool_ids == ["plugin.lookup.search"]
        updated = planning_catalog(owner, scope, "Hola")
        assert updated[0]["tools"] == [] and not updated[0]["capabilities"][1]["available"]


def test_a_runtime_revision_and_adapters_come_from_the_same_provider_read(monkeypatch):
    tools = catalogs.ToolCatalog()
    skills = catalogs.SkillCatalog(tools)
    monkeypatch.setattr(catalogs, "get_skill_catalog", lambda: skills)
    monkeypatch.setattr(catalogs, "get_tool_catalog", lambda: tools)
    skills.register_core({"id": "core.lookup", "name": "Lookup", "tool_ids": ["plugin.lookup.search"]})
    reads = []

    def handler():
        return "ok"

    def changing_provider():
        reads.append(1)
        return [{"id": "plugin.lookup.search", "name": "Search", "handler": handler,
                 "status": "available" if len(reads) == 1 else "suspended"}]

    tools.register_plugin_provider("lookup", changing_provider)
    profile = {"id": "agent", "skill_ids": ["core.lookup"]}
    first = catalogs.resolve_agent_runtime(profile)
    assert len(reads) == 1 and first.skills[0].available and first.tools == (handler,)
    second = catalogs.resolve_agent_runtime(profile)
    assert len(reads) == 2 and not second.skills[0].available and second.tools == ()
    assert first.catalog_revision != second.catalog_revision
