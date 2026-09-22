"""Concurrent catalog reads must not expose partially registered plugins."""
from concurrent.futures import ThreadPoolExecutor
import threading

from backend.models.agent_skills import CatalogStatus
from backend.services import agent_skill_catalog as catalog
from backend.services import llm_wiki_ai_contributions as brain


def test_concurrent_reader_waits_for_builtin_registration(monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    reader_waiting = threading.Event()
    real_lock = threading.RLock()
    owner = []

    class ObservedLock:
        def __enter__(self):
            if owner and threading.get_ident() != owner[0]:
                reader_waiting.set()
            real_lock.acquire()

        def __exit__(self, *_args):
            real_lock.release()

    tools = catalog.ToolCatalog()
    skills = catalog.SkillCatalog(tools)
    monkeypatch.setattr(catalog, '_TOOL_CATALOG', tools)
    monkeypatch.setattr(catalog, '_SKILL_CATALOG', skills)
    monkeypatch.setattr(catalog, '_BUILTIN_PROVIDER_LOCK', ObservedLock())
    monkeypatch.setattr(catalog, '_BUILTIN_PROVIDERS_REGISTERING', False)
    monkeypatch.setattr(catalog, '_BUILTIN_PROVIDER_HOOKS_REGISTERED', {'plugins', 'generated-tools'})
    monkeypatch.setattr(brain, '_status', lambda: CatalogStatus.AVAILABLE)
    register = brain.register_llm_wiki_contributions

    def delayed_registration():
        owner.append(threading.get_ident())
        # Re-entrant reads on the registering thread must not deadlock.
        assert catalog.get_skill_catalog() is skills
        entered.set()
        assert release.wait(5)
        register()

    monkeypatch.setattr(brain, 'register_llm_wiki_contributions', delayed_registration)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(catalog.get_skill_catalog)
        assert entered.wait(5)
        second = pool.submit(lambda: catalog.get_skill_catalog().descriptors())
        try:
            assert reader_waiting.wait(2), 'Reader bypassed the registration lock'
            assert not second.done()
        finally:
            release.set()
        first.result(timeout=5)
        entries = second.result(timeout=5)
    assert {key for key in entries if key.startswith('plugin.llm-wiki.')} == {
        'plugin.llm-wiki.query', 'plugin.llm-wiki.process-source',
        'plugin.llm-wiki.process-status', 'plugin.llm-wiki.maintain',
        'plugin.llm-wiki.propose-connections',
    }
