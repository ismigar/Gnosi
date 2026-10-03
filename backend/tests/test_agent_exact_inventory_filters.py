"""Exact relation inventories across languages, scopes and pagination."""

import json
from types import SimpleNamespace

import pytest

from backend.agent import agent_context as context
from backend.domains.agent.context import _inventory_request_arguments, _previous_inventory_arguments
from langchain_core.messages import HumanMessage, ToolMessage


@pytest.mark.parametrize("message", [
    'Busca todas las entradas de la tabla Cervell Digital donde recurs es "El papa de mis sueños" y asigna "En revisió" al campo estat.',
    'Find all entries in the Cervell Digital table where recurs is "El papa de mis sueños" and set estat to "En revisió".',
    'Cherche toutes les entrées de la table Cervell Digital où recurs est "El papa de mis sueños" et définis estat sur "En revisió".',

    'Busca totes les entrades de la taula Cervell Digital on recurs és "El papa de mis sueños". Indica el nombre exacte i els títols. No modifiquis res.',
    'Busca las filas de la tabla Cervell Digital cuyo recurs es exactamente "El papa de mis sueños".',
    'In the Cervell Digital table find rows whose recurs equals exactly "El papa de mis sueños". Do not change any data.',
    'Dans la table Cervell Digital, trouve les lignes dont recurs est exactement "El papa de mis sueños".',
])
def test_exact_predicate_keeps_the_title_and_discards_instruction_scaffolding(message):
    assert _inventory_request_arguments(message) == {
        "query": "", "record_types": ["Cervell Digital"], "include_relations": True,
        "offset": 0, "limit": 100, "property_filters": {"recurs": "El papa de mis sueños"},
    }


@pytest.fixture
def inventory(monkeypatch, tmp_path):
    tables = [
        {"id": "brain", "name": "Cervell Digital", "properties": [
            {"id": "source", "name": "recurs", "type": "relation", "relation_database_id": "resources"},
            {"id": "status", "name": "estat", "type": "status", "config": {"catalog_ref": "status"}},
        ]},
        {"id": "resources", "name": "Recursos", "properties": []},
    ]
    pages = {
        "resources": [SimpleNamespace(id=rid, title=title, metadata={}, path=tmp_path / f"{rid}.md")
                      for rid, title in [("exact", "El papa de mis sueños"), ("near", "El papa de mis sueños II")]],
        "brain": [SimpleNamespace(
            id=f"note-{i:03}", title=f"Note {i:03}", path=tmp_path / f"note-{i}.md",
            metadata={"status": "Pendent" if i == 0 else "Completat", "source": (["exact", "near"] if i == 0 else ["[[El papa de mis sueños|exact]]"] if i < 103 else ["near"])},
        ) for i in range(121)],
    }
    for values in pages.values():
        for page in values:
            page.path.write_text("No relevant title in the body.")
    monkeypatch.setattr(context, "_vault_root", lambda: tmp_path)
    monkeypatch.setattr(context, "_registry", lambda: {
        "tables": tables, "views": [], "option_catalogs": {"status": ["Pendent", "Completat"]},
    })
    monkeypatch.setattr(context, "_table_pages", lambda table_id: pages.get(table_id, []))
    refs = [{"id": table["id"], "type": "table", "ref": table["id"], "label": table["name"]} for table in tables]
    def build(attached=refs):
        return next(tool for tool in context.build_context_tools(attached) if tool.name == "inventory_context")
    return build, pages, refs


def test_exact_relation_matches_ids_and_multivalues_without_title_prefixes(inventory):
    build, _, _ = inventory
    args = {"record_types": ["brain"], "property_filters": {"recurs": "El papa de mis sueños"}}
    first = json.loads(build().invoke(args))
    assert first["searched_count"] == 121
    assert first["matching_count"] == 103
    assert first["inventory_basis"] == "attached_indexed_records"
    assert first["filesystem_snapshot_verified"] is False
    assert first["counts_by_match_kind"]["relation"] == 103
    status = next(field for field in first["field_definitions"]["brain"] if field["id"] == "status")
    assert [option["name"] for option in status["options"]] == ["Pendent", "Completat"]
    assert len(first["records"]) == 100
    assert first["has_more"] is True
    second = json.loads(build().invoke({**args, "offset": first["next_offset"]}))
    assert len(second["records"]) == 3
    assert second["has_more"] is False
    assert len({row["id"] for row in first["records"] + second["records"]}) == 103
    empty = json.loads(build().invoke({**args, "property_filters": {"recurs": "Absent"}}))
    assert empty["matching_count"] == 0
    from backend.domains.agent.responses import _inventory_context_response
    response = _inventory_context_response(json.dumps(first), "Busca les entrades")
    assert 'recurs = «El papa de mis sueños»' in response


def test_relation_target_must_be_attached_and_ambiguous_titles_require_clarification(inventory):
    build, pages, refs = inventory
    args = {"record_types": ["brain"], "property_filters": {"recurs": "El papa de mis sueños"}}
    with pytest.raises(PermissionError, match="not_attached"):
        build(refs[:1]).invoke(args)
    pages["resources"].append(SimpleNamespace(id="duplicate", title="El papa de mis sueños", metadata={}, path=pages["resources"][0].path))
    with pytest.raises(ValueError, match="ambiguous"):
        build().invoke(args)
    with pytest.raises(ValueError, match="field_not_resolved"):
        build().invoke({**args, "property_filters": {"misspelled": "value"}})


def test_multiple_exact_field_conditions_are_all_applied(inventory):
    build, _, _ = inventory
    args = _inventory_request_arguments(
        'Busca les files de la taula Cervell Digital on recurs és "El papa de mis sueños" i estat és "Pendent".'
    )
    assert args["property_filters"] == {"recurs": "El papa de mis sueños", "estat": "Pendent"}
    result = json.loads(build().invoke(args))
    assert result["matching_count"] == 1
    assert result["records"][0]["id"] == "note-000"


def test_inventory_continuation_preserves_exact_predicates():
    payload = {"query": "", "record_types_requested": ["brain"], "has_more": True,
               "next_offset": 100, "snapshot_revision": "frozen-result",
               "property_filters": {"recurs": "El papa de mis sueños"}}
    messages = [HumanMessage(content="Search"), ToolMessage(content=json.dumps(payload), name="inventory_context", tool_call_id="read"), HumanMessage(content="Continue")]
    assert _previous_inventory_arguments(messages)["property_filters"] == payload["property_filters"]
    assert _previous_inventory_arguments(messages)["expected_revision"] == "frozen-result"


def test_revision_bound_pagination_returns_every_match_once(inventory):
    build, _, _ = inventory
    args = {"record_types": ["brain"], "property_filters": {"recurs": "El papa de mis sueños"}}
    first = json.loads(build().invoke({**args, "limit": 17}))
    rows = list(first["records"])
    current = first
    while current["has_more"]:
        current = json.loads(build().invoke({**args, "limit": 17,
            "offset": current["next_offset"], "expected_revision": first["snapshot_revision"]}))
        assert current["snapshot_revision"] == first["snapshot_revision"]
        rows.extend(current["records"])
    assert len(rows) == len({row["id"] for row in rows}) == 103


def test_revision_accepts_numeric_frontmatter_keys_and_dictionary_reordering(inventory):
    build, pages, _ = inventory
    pages["brain"][0].metadata[2026] = {"alpha": 1, "beta": 2}
    args = {"record_types": ["brain"]}
    first = json.loads(build().invoke(args))
    pages["brain"][0].metadata[2026] = {"beta": 2, "alpha": 1}
    second = json.loads(build().invoke({**args, "offset": 100, "expected_revision": first["snapshot_revision"]}))
    assert second["snapshot_revision"] == first["snapshot_revision"]
    pages["brain"][0].metadata["2026"] = "A different key from numeric 2026"
    third = json.loads(build().invoke({**args, "offset": 100, "expected_revision": first["snapshot_revision"]}))
    assert third["error"] == "inventory_changed_restart_pagination"


@pytest.mark.parametrize("change", ["remove", "title", "metadata", "filter", "scope", "schema"])
def test_changed_inventory_does_not_mix_pages_or_report_zero_matches(inventory, change):
    build, pages, refs = inventory
    args = {"record_types": ["brain"], "property_filters": {"recurs": "El papa de mis sueños"}}
    first = json.loads(build().invoke(args))
    if change == "remove":
        pages["brain"].pop(0)
    elif change == "title":
        pages["brain"][0].title = "ZZZ moved to a different page"
    elif change == "metadata":
        pages["brain"][0].metadata["status"] = "En revisió"
    elif change == "filter":
        args["property_filters"] = {"recurs": "El papa de mis sueños II"}
    elif change == "scope":
        refs[0]["label"] = "Changed attached scope"
    else:
        context._registry()["tables"][0]["properties"].append({"id": "new", "name": "New", "type": "text"})
    result = json.loads(build().invoke({**args, "offset": first["next_offset"],
        "expected_revision": first["snapshot_revision"]}))
    assert result["error"] == "inventory_changed_restart_pagination"
    assert result["restart_required"] is True
    assert result["records"] == []
    assert "matching_count" not in result
    assert result["has_more"] is False
    messages = [HumanMessage(content="Search"), ToolMessage(content=json.dumps(result),
        name="inventory_context", tool_call_id="read"), HumanMessage(content="Continue")]
    assert _previous_inventory_arguments(messages) is None


@pytest.mark.parametrize("message,fragment", [
    ("Continua", "Cal repetir la cerca"), ("Busca las siguientes filas", "repetir la búsqueda"),
    ("Affiche les suivants", "relancer la recherche"), ("Continue", "Restart the search"),
])
def test_changed_inventory_message_is_localized(message, fragment):
    from backend.domains.agent.responses import _inventory_context_response
    response = _inventory_context_response(json.dumps({"error": "inventory_changed_restart_pagination"}), message)
    assert fragment in response


def test_changed_inventory_remains_a_failure_after_final_evidence_verification():
    from langchain_core.messages import AIMessage
    from backend.agent.turn_contract import verify_response
    from backend.domains.agent.responses import _inventory_context_response
    payload = json.dumps({"error": "inventory_changed_restart_pagination", "records": [], "has_more": False})
    text = _inventory_context_response(payload, "Continua")
    verified = verify_response(AIMessage(content=text), messages=[HumanMessage(content="Continua"),
        ToolMessage(content=payload, name="inventory_context", tool_call_id="read")],
        plan={"mode": "inventory", "language": "ca", "verification": {"source_evidence_required": True}})
    assert "Cal repetir la cerca" in verified.content
    assert verified.additional_kwargs["gnosi_verification"]["status"] != "passed"
    assert verified.additional_kwargs["gnosi_verification"]["checks"]["tool_results_successful"] is False
    assert verified.additional_kwargs["gnosi_quality"]["checks"]["inventory_complete"] is False


@pytest.mark.parametrize("message,language", [
    ('Find rows whose recurs equals "El papa de mis sueños".', "en"),
    ('Troba les files amb recurs «Mes ressources».', "ca"),
    ('Busca las filas cuyo recurs es "Els meus projectes".', "es"),
    ('Trouve les lignes dont recurs est “Les meves tasques”.', "fr"),
])
def test_quoted_resource_language_does_not_override_the_instruction(message, language):
    from backend.domains.agent.responses import _response_language
    assert _response_language(message) == language


def test_fresh_relation_terms_and_body_do_not_use_stale_text_cache():
    from backend.domains.agent.context_inventory_tools import InventoryContextTool
    records=[{'id':'note-1','title':'Note','metadata':{'resource':['[[Old alias|resource-1]]']},'path':'fixture','_fresh_body':'Current body'},
             {'id':'resource-1','title':'New resource title','metadata':{},'path':'resource'}]
    terms=InventoryContextTool._fresh_relation_terms(records)
    body,related,cached=InventoryContextTool._record_text(records[0],{'fixture':'Stale body'},terms,include_relations=True)
    assert body == 'Current body' and related == 'New resource title' and cached is False


@pytest.mark.parametrize('change', ['body', 'metadata', 'create', 'remove', 'replace'])
def test_concurrent_changes_during_body_reads_return_no_partial_inventory(inventory, monkeypatch, change):
    from backend.domains.agent import context_inventory_tools as tools

    build, pages, _ = inventory
    monkeypatch.setattr(tools.InventoryContextTool, '_refresh_index', staticmethod(lambda _root: True))
    original = tools._page_body
    mutated = False

    def read(page):
        nonlocal mutated
        body = original(page)
        if not mutated:
            mutated = True
            target = pages['brain'][-1]
            if change == 'body':
                target.path.write_text('Changed during the inventory read.')
            elif change == 'metadata':
                target.metadata['status'] = 'Changed during the read'
            elif change == 'create':
                path = target.path.parent / 'concurrently-created.md'
                path.write_text('New record')
                pages['brain'].append(SimpleNamespace(id='new-row', title='New', path=path, metadata={}))
            elif change == 'remove':
                pages['brain'].pop().path.unlink()
            else:
                replacement = target.path.with_suffix('.replacement')
                replacement.write_bytes(target.path.read_bytes())
                replacement.replace(target.path)
        return body

    monkeypatch.setattr(tools, '_page_body', read)
    result = json.loads(build().invoke({'record_types': ['brain']}))
    assert mutated
    assert result['error'] == 'inventory_changed_restart_pagination'
    assert result['restart_required'] and result['records'] == [] and not result['has_more']
    assert 'matching_count' not in result


def test_stable_reindexed_inventory_can_continue_without_claiming_atomic_snapshot(inventory, monkeypatch):
    from backend.domains.agent import context_inventory_tools as tools

    build, _, _ = inventory
    monkeypatch.setattr(tools.InventoryContextTool, '_refresh_index', staticmethod(lambda _root: True))
    first = json.loads(build().invoke({'record_types': ['brain'], 'limit': 17}))
    assert first['matching_count'] == 121
    assert first['concurrent_change_check'] == 'attached_records_reindexed_and_statted'
    assert first['filesystem_snapshot_verified'] is False
    second = json.loads(build().invoke({'record_types': ['brain'], 'limit': 17,
        'offset': first['next_offset'], 'expected_revision': first['snapshot_revision']}))
    assert second['snapshot_revision'] == first['snapshot_revision']
    assert not set(row['id'] for row in first['records']).intersection(row['id'] for row in second['records'])


@pytest.mark.parametrize('busy_at', [1, 2])
def test_busy_refresh_never_returns_a_stale_or_partial_inventory(inventory, monkeypatch, busy_at):
    from backend.domains.agent import context_inventory_tools as tools

    build, _, _ = inventory
    calls = 0

    def refresh(_root):
        nonlocal calls
        calls += 1
        if calls == busy_at:
            raise RuntimeError('vault_index_refresh_in_progress')
        return True

    monkeypatch.setattr(tools.InventoryContextTool, '_refresh_index', staticmethod(refresh))
    result = json.loads(build().invoke({'record_types': ['brain']}))
    assert calls == busy_at
    assert result['error'] == 'inventory_changed_restart_pagination'
    assert result['restart_required'] and result['records'] == []
    assert 'matching_count' not in result


@pytest.mark.parametrize('message', [
    "Llista'm les propietats de la taula cervell digital",
    'Lista las propiedades de la tabla Cervell Digital',
    'List the properties of the Cervell Digital table',
    'Liste les propriétés de la table Cervell Digital',
])
def test_schema_request_lists_fields_instead_of_matching_property_text(inventory, message):
    from backend.domains.agent.responses import _inventory_context_response
    from backend.domains.agent.intent import _request_mode
    build, pages, _ = inventory
    pages['brain'].clear()  # Empty tables still have a schema.
    args = _inventory_request_arguments(message)
    assert args == {'query': '', 'record_types': ['cervell digital'], 'schema_only': True}
    assert _request_mode(message) == 'inventory'
    payload = json.loads(build().invoke(args))
    assert payload['result_kind'] == 'table_schema'
    assert [field['name'] for field in payload['tables'][0]['fields']] == ['recurs', 'estat']
    assert payload['tables'][0]['fields'][0]['relation_database_id'] == 'resources'
    assert [option['name'] for option in payload['tables'][0]['fields'][1]['options']] == ['Pendent', 'Completat']
    answer = _inventory_context_response(json.dumps(payload), message)
    assert 'recurs — relation' in answer
    assert 'estat — status' in answer
    assert 'Note' not in answer


def test_schema_cannot_read_unattached_tables(inventory):
    build, _, refs = inventory
    payload = json.loads(build(refs[1:]).invoke({'schema_only': True, 'record_types': ['Cervell Digital']}))
    assert payload['tables'] == []
    assert payload['record_types_unresolved'] == ['Cervell Digital']


def test_record_search_for_word_properties_remains_a_record_search():
    args = _inventory_request_arguments('Find all records in Cervell Digital containing properties')
    assert not args.get('schema_only')
    assert 'properties' in args['query']
