"""Tests de l'orquestrador del clon exacte (pur + E2E amb fakes, sense xarxa)."""
import sys
from pathlib import Path

# arrel `gnosi` al path → `backend.services...` importable (com al runtime)
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.notion_clone import (  # noqa: E402
    clone_table_id, clone_page_id, clone_table_schema, clone_values,
    resolve_view_markers, clone_workspace,
)
from backend.services import notion_mcp_md  # noqa: E402

HOST = "1d3268e52714809ab328fc33d9331454"
VIEW_MD = (
    'The title of this Data Source is: 📀 Tasques\n'
    '<views>\n<view url="{{view://x}}">\n'
    '{"dataSourceUrl":"{{collection://x}}","displayProperties":["Nom","Estat"],'
    '"name":"","simpleFilters":[{"filter":{"operator":"relation_contains",'
    '"property":"📀 Projecte","propertyType":"relation","type":"property",'
    '"value":{"type":"exact","value":"https://app.notion.com/p/1d3268e52714809ab328fc33d9331454"}},'
    '"id":"f"}],"type":"table"}\n</view>\n</views>'
)
CLONE_TASQUES = {
    "id": clone_table_id("tasks"), "name": "Tasques",
    "properties": [
        {"name": "Nom", "type": "title"},
        {"name": "Projecte", "type": "relation", "relation_database_id": clone_table_id("projects")},
    ],
}


def test_clone_ids_namespaced_and_deterministic():
    assert clone_table_id("90e31c41-f815-489b-99f3-0086b120cbfa") == clone_table_id("90e31c41f815489b99f30086b120cbfa")
    assert clone_page_id("p1") == clone_page_id("p1")
    # diferent del raw / de la taula existent
    assert clone_table_id("tasks") != "tasks"
    assert clone_page_id("p1") != "p1"


def test_clone_table_schema_relations_namespaced():
    db = {"id": "projects", "title": [{"plain_text": "Projects"}], "properties": {
        "Name": {"id": "t", "type": "title", "title": {}},
        "Tasks": {"id": "r", "type": "relation", "relation": {"database_id": "tasks"}},
    }}
    t = clone_table_schema(db)
    assert t["id"] == clone_table_id("projects")
    rel = next(p for p in t["properties"] if p["name"] == "Tasks")
    assert rel["relation_database_id"] == clone_table_id("tasks")   # apunta a la taula CLONADA


def test_clone_values_remaps_only_relations():
    schema = [{"name": "Tasques", "type": "relation"}, {"name": "Tags", "type": "multi_select"}]
    vals = {"Tasques": ["t1", "t2"], "Tags": ["a", "b"], "Nom": "X"}
    out = clone_values(vals, schema)
    assert out["Tasques"] == [clone_page_id("t1"), clone_page_id("t2")]  # relacions → clon
    assert out["Tags"] == ["a", "b"]   # multi_select intacte
    assert out["Nom"] == "X"


def test_resolve_view_markers_to_clone_view():
    body = "## Planificació\n<!-- gnosi-notion-db:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\nfi"
    new_body, views = resolve_view_markers(
        body, HOST, clone_table_id("projects"),
        fetch_view=lambda vid: VIEW_MD,
        resolve_clone_table=lambda n: CLONE_TASQUES if "tasques" in (n or "").lower() else None)
    assert "<!-- gnosi-view:def" in new_body          # marcador → embed
    assert "gnosi-notion-db" not in new_body
    assert len(views) == 1
    assert views[0]["table_id"] == clone_table_id("tasks")    # vista de la taula clonada
    assert views[0]["filters"] == [{"field": "Projecte", "value": "this"}]


class FakeRest:
    def __init__(self):
        self.dbs = {
            "projects": {"id": "projects", "title": [{"plain_text": "Projectes"}], "properties": {
                "Nom": {"id": "t", "type": "title", "title": {}}}},
            # la vista de la pàgina referencia "Tasques" → cal clonar-la també (passada 1)
            "tasks": {"id": "tasks", "title": [{"plain_text": "Tasques"}], "properties": {
                "Nom": {"id": "t", "type": "title", "title": {}}}},
        }
        self.rows = {"projects": [{"id": HOST, "properties": {
            "Nom": {"type": "title", "title": [{"plain_text": "Postgrau"}]}}}], "tasks": []}
    def list_users(self): return {}
    def get_database(self, i): return self.dbs[i]
    def query_database(self, i):
        for r in self.rows.get(i, []):
            yield r


def test_clone_workspace_end_to_end_with_fakes():
    # MCP: la pàgina té un marcador de vista; el fetch de la vista torna VIEW_MD
    PAGE_MCP = ('<page><content>\n## Planificació\n'
                '<database url="https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" inline="true"></database>\n'
                '</content></page>')
    def fetch_page(nid):
        return PAGE_MCP if nid == HOST else VIEW_MD

    tables, pages, views = [], [], []
    rep = clone_workspace(
        FakeRest(), fetch_page=fetch_page, mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
        write_table=tables.append, write_page=pages.append, write_view=views.append,
        database_ids=["projects", "tasks"], target_folder="Clon Notion")
    assert rep["tables"] == 2 and rep["pages"] == 1
    assert tables[0]["id"] == clone_table_id("projects")
    assert tables[0]["folder"] == "Clon Notion/Projectes"
    p = pages[0]
    assert p["id"] == clone_page_id(HOST)
    assert p["metadata"]["table_id"] == clone_table_id("projects")
    assert "<!-- gnosi-view:def" in p["content"]   # la vista incrustada s'ha recreat al cos
    assert rep["views"] == 1


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn(); print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1; print(f"FAIL {fn.__name__}"); traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
