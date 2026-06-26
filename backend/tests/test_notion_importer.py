"""Test de les transformacions pures de l'importador de Notion (sense token ni xarxa)."""
import sys
from pathlib import Path

# Permet importar el mòdul de transforms sense arrossegar tot el backend.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_importer import (  # noqa: E402
    map_database_schema, map_property_schema, rich_text_to_md, value_to_gnosi,
    page_to_values, blocks_to_md, default_views_for_table, gnosi_id_for,
    discover_block_refs, import_workspace,
)


class FakeClient:
    """Client de Notion fals (sense xarxa) per provar el crawler de tancament."""
    def __init__(self, dbs, rows, blocks, pages, loose=None):
        self.dbs, self.rows, self.blocks, self.pages = dbs, rows, blocks, pages
        self.loose = loose or []  # resultats de search_pages (object=page)
        self.queried = []

    def list_users(self):
        return {}

    def search_databases(self):
        return [{"id": k} for k in self.dbs]

    def search_pages(self):
        return list(self.loose)

    def get_database(self, db_id):
        return self.dbs[db_id]

    def query_database(self, db_id):
        self.queried.append(db_id)
        for r in self.rows.get(db_id, []):
            yield r

    def get_block_children(self, bid):
        return self.blocks.get(bid, [])

    def get_page(self, pid):
        return self.pages[pid]


def _title_prop(text):
    return {"type": "title", "title": [{"plain_text": text}]}


def _relation_prop(*ids):
    return {"type": "relation", "relation": [{"id": i} for i in ids]}


def _fixture():
    dbs = {
        "projects": {"id": "projects", "title": [{"plain_text": "Projects"}], "properties": {
            "Name": {"id": "t", "type": "title", "title": {}},
            "Tasks": {"id": "r", "type": "relation", "relation": {"database_id": "tasks"}},
        }},
        "tasks": {"id": "tasks", "title": [{"plain_text": "Tasks"}], "properties": {
            "Name": {"id": "t", "type": "title", "title": {}},
            "Project": {"id": "r", "type": "relation", "relation": {"database_id": "projects"}},
        }},
    }
    rows = {
        "projects": [{"id": "p1", "properties": {"Name": _title_prop("Proj 1"), "Tasks": _relation_prop("t1")}}],
        "tasks": [{"id": "t1", "properties": {"Name": _title_prop("Task 1"), "Project": _relation_prop("p1")}}],
    }
    blocks = {
        "p1": [
            {"id": "cp1", "type": "child_page", "child_page": {"title": "Notes de p1"}},
            {"type": "paragraph", "paragraph": {"rich_text": [
                {"type": "mention", "plain_text": "Task 1", "mention": {"type": "page", "page": {"id": "t1"}}}]}},
        ],
        "cp1": [{"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "standalone"}]}}],
        "t1": [],
    }
    pages = {
        "cp1": {"id": "cp1", "parent": {"type": "page_id", "page_id": "p1"},
                "properties": {"title": _title_prop("Notes de p1")}},
        "t1": {"id": "t1", "parent": {"type": "database_id", "database_id": "tasks"}, "properties": {}},
    }
    return FakeClient(dbs, rows, blocks, pages)


def test_discover_block_refs():
    blocks = [
        {"id": "cp1", "type": "child_page", "child_page": {"title": "x"}},
        {"id": "cdb1", "type": "child_database", "child_database": {"title": "y"}},
        {"type": "link_to_page", "link_to_page": {"type": "page_id", "page_id": "pg9"}},
        {"type": "paragraph", "paragraph": {"rich_text": [
            {"type": "mention", "mention": {"type": "database", "database": {"id": "db9"}}}]}, "_children": [
            {"type": "paragraph", "paragraph": {"rich_text": [
                {"type": "mention", "mention": {"type": "page", "page": {"id": "deep"}}}]}}]},
    ]
    db_ids, page_ids = discover_block_refs(blocks)
    assert db_ids == {"cdb1", "db9"}
    assert page_ids == {"cp1", "pg9", "deep"}


def test_crawler_transitive_closure_no_orphans():
    fc = _fixture()
    tables, pages, views = [], [], []
    report = import_workspace(fc, write_table=tables.append, write_page=pages.append,
                              write_view=views.append, database_ids=["projects"])
    table_ids = {t["id"] for t in tables}
    # Tancament: tot i seleccionar NOMÉS projects, s'importa també tasks (relació)
    assert gnosi_id_for("projects", "table") in table_ids
    assert gnosi_id_for("tasks", "table") in table_ids
    assert report["databases"] == 2
    # 3 pàgines: fila p1 + fila t1 + child_page autònom cp1
    written_ids = {p["id"] for p in pages}
    assert gnosi_id_for("p1", "page") in written_ids
    assert gnosi_id_for("t1", "page") in written_ids
    assert gnosi_id_for("cp1", "page") in written_ids  # child_page no queda orfe
    assert report["pages"] == 3
    assert report["truncated"] is False


def test_crawler_cycle_safe():
    # projects↔tasks es referencien mútuament; el crawler no s'ha de penjar ni duplicar
    fc = _fixture()
    tables = []
    import_workspace(fc, write_table=tables.append, write_page=lambda p: None,
                     write_view=lambda v: None, database_ids=["projects"])
    # cada BD consultada una sola vegada (visitats eviten el bucle del cicle)
    assert fc.queried.count("projects") == 1
    assert fc.queried.count("tasks") == 1


def test_crawler_max_pages_truncates_and_reports():
    fc = _fixture()
    pages = []
    report = import_workspace(fc, write_table=lambda t: None, write_page=pages.append,
                              write_view=lambda v: None, database_ids=["projects"], max_pages=1)
    assert report["truncated"] is True
    assert report["pages"] <= 1  # tall reportat, no silenciós


def test_crawler_only_new_skips_existing():
    # Sync guardat: p1 ja existeix al vault → NO es reimporta (no sobreescriu);
    # t1 és nova → s'importa. Mai toca el que ja hi és.
    fc = _fixture()
    pages = []
    existing = {"p1"}
    report = import_workspace(fc, write_table=lambda t: None, write_page=pages.append,
                              write_view=lambda v: None, database_ids=["projects"],
                              exists=lambda nid, title: nid in existing, only_new=True)
    written_ids = {p["id"] for p in pages}
    assert gnosi_id_for("p1", "page") not in written_ids   # existent → saltada
    assert gnosi_id_for("t1", "page") in written_ids        # nova → importada
    assert report["skipped_existing"] == 1


def test_crawler_include_loose_pages():
    # include_loose_pages sembra el crawler amb pàgines soltes (parent page/workspace);
    # les files de BD (parent database_id) es filtren al seed (entren per la seva BD).
    fc = _fixture()
    fc.loose = [
        {"id": "lp1", "parent": {"type": "page_id", "page_id": "root"}},          # solta → importa
        {"id": "t1", "parent": {"type": "database_id", "database_id": "tasks"}},   # fila BD → filtrada
    ]
    fc.pages["lp1"] = {"id": "lp1", "parent": {"type": "page_id", "page_id": "root"},
                       "properties": {"title": _title_prop("Nota solta")}}
    fc.blocks["lp1"] = []

    on = []
    import_workspace(fc, write_table=lambda t: None, write_page=on.append,
                     write_view=lambda v: None, database_ids=["projects"], include_loose_pages=True)
    assert gnosi_id_for("lp1", "page") in {p["id"] for p in on}   # solta importada

    off = []
    import_workspace(fc, write_table=lambda t: None, write_page=off.append,
                     write_view=lambda v: None, database_ids=["projects"], include_loose_pages=False)
    assert gnosi_id_for("lp1", "page") not in {p["id"] for p in off}  # sense l'opció, no hi és


def test_crawler_db_row_not_imported_as_standalone():
    # t1 es descobreix com a menció (pàgina), però el seu parent és una BD → s'enruta a tasks,
    # no s'importa com a pàgina solta sense table_id.
    fc = _fixture()
    pages = []
    import_workspace(fc, write_table=lambda t: None, write_page=pages.append,
                     write_view=lambda v: None, database_ids=["projects"])
    t1 = next(p for p in pages if p["id"] == gnosi_id_for("t1", "page"))
    assert t1["metadata"].get("table_id") == gnosi_id_for("tasks", "table")  # és fila, no solta


def _rt(text, **ann):
    return {"plain_text": text, "annotations": ann, "href": ann.pop("href", None) if "href" in ann else None}


def test_rich_text_formatting():
    rich = [
        {"plain_text": "bold", "annotations": {"bold": True}},
        {"plain_text": " and ", "annotations": {}},
        {"plain_text": "code", "annotations": {"code": True}},
        {"plain_text": " link", "annotations": {}, "href": "http://x.com"},
    ]
    assert rich_text_to_md(rich) == "**bold** and `code`[ link](http://x.com)"


def test_property_schema_mapping():
    db = {
        "id": "db-123", "title": [{"plain_text": "Projects"}],
        "icon": {"type": "emoji", "emoji": "📀"},
        "properties": {
            "Name": {"id": "title", "type": "title", "title": {}},
            "Estat": {"id": "s1", "type": "status", "status": {"options": [
                {"name": "Fet", "color": "green"}, {"name": "Actiu", "color": "blue"}]}},
            "Tags": {"id": "m1", "type": "multi_select", "multi_select": {"options": [
                {"name": "a", "color": "red"}]}},
            "Tasks": {"id": "r1", "type": "relation", "relation": {"database_id": "db-999"}},
            "Score": {"id": "f1", "type": "formula", "formula": {}},
        },
    }
    table = map_database_schema(db)
    assert table["name"] == "Projects"
    assert table["icon"] == "📀"
    assert table["id"] == gnosi_id_for("db-123", "table")
    by_name = {p["name"]: p for p in table["properties"]}
    assert by_name["Name"]["type"] == "title"
    assert by_name["Estat"]["type"] == "status"
    assert by_name["Estat"]["options"][0] == {"name": "Fet", "color": "green"}
    assert by_name["Tags"]["type"] == "multi_select"
    # relació apunta a l'ID de Gnosi derivat de la BD destí
    assert by_name["Tasks"]["relation_database_id"] == gnosi_id_for("db-999", "table")
    # formula = read-only
    assert by_name["Score"]["read_only"] is True


def test_value_extraction():
    users = {"u1": "Ismael"}
    page = {"properties": {
        "Name": {"type": "title", "title": [{"plain_text": "Hola"}]},
        "Done": {"type": "checkbox", "checkbox": True},
        "Estat": {"type": "status", "status": {"name": "Actiu"}},
        "Tags": {"type": "multi_select", "multi_select": [{"name": "x"}, {"name": "y"}]},
        "When": {"type": "date", "date": {"start": "2026-01-01", "end": "2026-01-05"}},
        "Owner": {"type": "people", "people": [{"id": "u1"}]},
        "Tasks": {"type": "relation", "relation": [{"id": "pg-1"}]},
    }}
    vals = page_to_values(page, users)
    assert vals["Name"] == "Hola"
    assert vals["Done"] is True
    assert vals["Estat"] == "Actiu"
    assert vals["Tags"] == ["x", "y"]
    assert vals["When"] == {"start": "2026-01-01", "end": "2026-01-05"}
    assert vals["Owner"] == "Ismael"
    # relació: IDs traduïts a Gnosi (passada B els cablejarà)
    assert vals["Tasks"] == [gnosi_id_for("pg-1", "page")]


def test_blocks_to_markdown_with_nesting():
    blocks = [
        {"type": "heading_1", "heading_1": {"rich_text": [{"plain_text": "Títol"}]}},
        {"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "Text"}]}},
        {"type": "to_do", "to_do": {"checked": True, "rich_text": [{"plain_text": "fet"}]}},
        {"type": "bulleted_list_item",
         "bulleted_list_item": {"rich_text": [{"plain_text": "pare"}]},
         "_children": [
             {"type": "bulleted_list_item",
              "bulleted_list_item": {"rich_text": [{"plain_text": "fill"}]}}]},
        {"type": "code", "code": {"language": "python",
                                  "rich_text": [{"plain_text": "x=1"}]}},
        {"type": "divider", "divider": {}},
    ]
    md = blocks_to_md(blocks)
    assert "# Títol" in md
    assert "- [x] fet" in md
    assert "  - fill" in md  # niat amb indentació
    assert "```python\nx=1\n```" in md
    assert "---" in md


def test_default_views_group_heuristic():
    table = {"id": "t1", "properties": [
        {"name": "Name", "type": "title"},
        {"name": "Estat", "type": "status"},
    ]}
    views = default_views_for_table(table, create_group_view=True)
    assert len(views) == 2
    assert views[0]["type"] == "table" and "groupBy" not in views[0]
    assert views[1]["groupBy"] == "Estat"
    # sense camp agrupable → només la vista principal
    table2 = {"id": "t2", "properties": [{"name": "Name", "type": "title"}]}
    assert len(default_views_for_table(table2, create_group_view=True)) == 1


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
