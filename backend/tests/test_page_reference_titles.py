from backend.domains.vault.links.parsing import normalize_ref, extract_outlinks
from backend.domains.vault.links.titles import reference_title, readable_title
from backend.services import llm_wiki_indices
from types import SimpleNamespace

ID = "d183c9c7-8177-5376-b8f0-f448f9837123"


def test_relation_dimension_labels_use_the_current_page_title():
    resolve = lambda identifier: "Filosofia i espiritualitat" if identifier == ID else ""
    for value in (ID, {"id": ID, "name": "Old name"}, f"[[Old name|{ID}]]", f"[[{ID}|Old name]]"):
        assert reference_title(value, resolve) == "Filosofia i espiritualitat"
    assert readable_title(f"Índex · Àrea: {ID}", resolve) == "Índex · Àrea: Filosofia i espiritualitat"
    assert ID not in reference_title(ID, lambda _: "")


def test_reference_titles_use_the_real_vault_index_port(monkeypatch):
    from backend.domains.vault.links import runtime
    monkeypatch.setattr(runtime, "build_id_title_index", lambda: {ID: "Filosofia i espiritualitat"})
    assert llm_wiki_indices._resolve_page_title(ID) == "Filosofia i espiritualitat"


def test_native_and_protected_citations_are_internal_resource_links():
    for href in (f"gnosi-cite:?res={ID}&page=7", f"https://gnosi-cite.local/?res={ID}&page=7"):
        assert normalize_ref(href) == ID
        assert ID in extract_outlinks({}, f"[p. 7]({href})")


def test_knowledge_routes_use_the_page_identity():
    for path in (f"/@principal/knowledge/page/{ID}", f"/api/v1/vaults/principal/knowledge/pages/{ID}"):
        assert normalize_ref(path) == ID


def test_generated_relation_indexes_keep_stable_identity_and_metadata(monkeypatch):
    captured = []
    prop = {"id": "area", "name": "Àrea", "type": "relation"}
    monkeypatch.setattr(llm_wiki_indices, "_table", lambda _: {"properties": [prop]})
    monkeypatch.setattr(llm_wiki_indices, "_resolve_page_title", lambda identifier: "Filosofia i espiritualitat" if identifier == ID else "")
    monkeypatch.setattr(llm_wiki_indices, "_upsert_managed_page", lambda *args, **kwargs:
                        captured.append((args, kwargs)) or {"id": "index", "title": args[1]})
    page = SimpleNamespace(id="note", title="A reading", metadata={"note_type": "lectura", "Àrea": [ID]})
    result = llm_wiki_indices._rebuild_dimension_indexes("brain", prop, [page], [], {"ui_locale": "ca", "brain_roles": {}})
    assert result[0]["title"] == "Índex · Àrea: Filosofia i espiritualitat"
    assert captured[0][0][5]["Àrea"] == ID
    assert captured[0][0][3] == f"dimension:area:{llm_wiki_indices._value_key(ID)}"
