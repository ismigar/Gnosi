"""Tests for the exact clone orchestrator (pure + E2E with fakes, no network)."""
import sys
from pathlib import Path

# `gnosi` root on the path → `backend.services...` importable (as at runtime)
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
    # different from the raw / from the existing table
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
    assert rel["relation_database_id"] == clone_table_id("tasks")   # points to the CLONED table


def test_clone_values_remaps_only_relations():
    schema = [{"name": "Tasques", "type": "relation"}, {"name": "Tags", "type": "multi_select"}]
    vals = {"Tasques": ["t1", "t2"], "Tags": ["a", "b"], "Nom": "X"}
    out = clone_values(vals, schema)
    assert out["Tasques"] == [clone_page_id("t1"), clone_page_id("t2")]  # relations → clone
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
    assert views[0]["table_id"] == clone_table_id("tasks")    # view of the cloned table
    assert views[0]["filters"] == [{"field": "Projecte", "value": "this"}]


# block with TWO tabs (the 2nd with groupBy and an emoji field): previously only the 1st was imported
VIEW_MD_TABS = (
    'The title of this Data Source is: 📀 Tasques\n'
    '<views>\n<view url="{{view://11111111-aaaa-5aaa-8aaa-aaaaaaaaaaaa}}">\n'
    '{"dataSourceUrl":"{{collection://x}}","displayProperties":["Nom","Estat"],'
    '"name":"Taula","type":"table"}\n</view>\n'
    '<view url="{{view://22222222-bbbb-5bbb-8bbb-bbbbbbbbbbbb}}">\n'
    '{"dataSourceUrl":"{{collection://x}}","displayProperties":["Nom"],'
    '"groupBy":{"property":"📀 Projecte"},"name":"Per projecte","type":"board"}\n</view>\n'
    '</views>'
)


def test_resolve_view_markers_multi_tab_all_views():
    import uuid as _uuid
    from backend.services.notion_clone import _CLONE_NS
    body = "## Planificació\n<!-- gnosi-notion-db:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\nfi"
    new_body, views = resolve_view_markers(
        body, HOST, clone_table_id("projects"),
        fetch_view=lambda vid: VIEW_MD_TABS,
        resolve_clone_table=lambda n: CLONE_TASQUES if "tasques" in (n or "").lower() else None)
    assert len(views) == 2
    # ONE single embed per block (the anchor); the rest are tabs (`tabs` field), like in Notion
    assert new_body.count("<!-- gnosi-view:def") == 1
    assert [v["name"] for v in views] == ["Taula", "Per projecte"]
    assert [v["type"] for v in views] == ["table", "board"]
    # 1st tab: LEGACY id (embeds from previous clones keep resolving to it)
    legacy = str(_uuid.uuid5(_CLONE_NS, f"view:{HOST}:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
    assert views[0]["id"] == legacy
    assert views[0]["tabs"] == [views[1]["id"]]
    assert views[1]["id"] != legacy
    assert legacy in new_body and views[1]["id"] not in new_body
    # fields clean of emoji also in the groupBy of the 2nd tab
    assert views[1]["groupBy"] == "Projecte"


def test_resolve_view_markers_skips_suggested_charts():
    """The MCP returns 'suggested' chart views that are NOT real tabs in Notion:
    they must not be cloned (user report 2026-07-08: 'I don't have any chart')."""
    view_md_chart = (
        'The title of this Data Source is: 📀 Tasques\n'
        '<views>\n<view url="{{view://11111111-aaaa-5aaa-8aaa-aaaaaaaaaaaa}}">\n'
        '{"dataSourceUrl":"{{collection://x}}","displayProperties":["Nom"],'
        '"name":"Taula","type":"table"}\n</view>\n'
        '<view url="{{view://33333333-cccc-5ccc-8ccc-cccccccccccc}}">\n'
        '{"chartConfig":{"dataConfig":{"aggregationConfig":{"aggregation":{"aggregator":"count"}},'
        '"groupBy":{"property":"Estat"}},"type":"bar"},'
        '"dataSourceUrl":"{{collection://x}}","name":"📊 Per estat","type":"chart"}\n</view>\n'
        '</views>'
    )
    body = "<!-- gnosi-notion-db:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->"
    new_body, views = resolve_view_markers(
        body, HOST, clone_table_id("projects"),
        fetch_view=lambda vid: view_md_chart,
        resolve_clone_table=lambda n: CLONE_TASQUES if "tasques" in (n or "").lower() else None)
    assert [v["name"] for v in views] == ["Taula"]        # the suggested chart is NOT cloned
    assert views[0]["tabs"] == []
    assert new_body.count("<!-- gnosi-view:def") == 1


class FakeRest:
    def __init__(self):
        self.dbs = {
            "projects": {"id": "projects", "title": [{"plain_text": "Projectes"}], "properties": {
                "Nom": {"id": "t", "type": "title", "title": {}}}},
            # the page view references "Tasques" → it must be cloned too (pass 1)
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
    # MCP: the page has a view marker; fetching the view returns VIEW_MD
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
    assert "<!-- gnosi-view:def" in p["content"]   # the embedded view has been recreated in the body
    assert rep["views"] == 1


class FakeRestAreas:
    """DB with an emoji field, a relation, and created_time to test cleanup+decoration+dates."""
    def list_users(self): return {}
    def search_databases(self): return [{"id": "areas"}]
    def get_database(self, i):
        return {"id": "areas", "title": [{"plain_text": "Àrees"}], "properties": {
            "Nom": {"id": "t", "type": "title", "title": {}},
            "📀 Projectes": {"id": "r", "type": "relation", "relation": {"database_id": "areas"}},
            "Data de creació": {"id": "d", "type": "created_time", "created_time": {}}}}
    def query_database(self, i):
        mk = lambda pid, nom, rel: {"id": pid, "icon": None, "properties": {
            "Nom": {"type": "title", "title": [{"plain_text": nom, "type": "text"}]},
            "📀 Projectes": {"type": "relation", "relation": rel},
            "Data de creació": {"type": "created_time", "created_time": "2025-04-11T16:22:00.000Z"}}}
        return [mk("11111111-1111-1111-1111-111111111111", "Filosofia",
                   [{"id": "22222222-2222-2222-2222-222222222222"}]),
                mk("22222222-2222-2222-2222-222222222222", "Oci", [])]


def test_clone_strips_field_emojis_decorates_relations_and_dates():
    pages = []
    clone_workspace(FakeRestAreas(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                    database_ids=["areas"])
    m = next(p for p in pages if p["title"] == "Filosofia")["metadata"]
    assert "Projectes" in m and "📀 Projectes" not in m          # emoji stripped from the field name
    oci = clone_page_id("22222222-2222-2222-2222-222222222222")
    assert m["Projectes"] == [f"[[Oci|{oci}]]"]                  # decorated relation (forward ref)
    assert m["Data de creació"] == "2025-04-11T16:22:00.000Z"    # date AS-IS (the time is preserved)


class FakeRestIcons:
    """Pages with an image/emoji icon and a cover, to test icon+cover downloading."""
    def list_users(self): return {}
    def search_databases(self): return [{"id": "areas"}]
    def get_database(self, i):
        return {"id": "areas", "title": [{"plain_text": "Àrees"}],
                "properties": {"Nom": {"id": "t", "type": "title", "title": {}}}}
    def query_database(self, i):
        return [
            {"id": "11111111-1111-1111-1111-111111111111",
             "icon": {"type": "file", "file": {"url": "https://s3/i.png"}},
             "cover": {"type": "external", "external": {"url": "https://ex/c.jpg"}},
             "properties": {"Nom": {"type": "title", "title": [{"plain_text": "Img", "type": "text"}]}}},
            {"id": "22222222-2222-2222-2222-222222222222",
             "icon": {"type": "emoji", "emoji": "📌"}, "cover": None,
             "properties": {"Nom": {"type": "title", "title": [{"plain_text": "Emoji", "type": "text"}]}}}]


def test_clone_downloads_image_icons_and_covers():
    saved = []
    def save_asset(url, prop, table):
        saved.append(prop)
        return f"Assets/Clon Notion/{table['name']}/{prop}/x.png"
    pages = []
    rep = clone_workspace(FakeRestIcons(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                          write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                          database_ids=["areas"], save_asset=save_asset)
    img = next(p for p in pages if p["title"] == "Img")["metadata"]
    assert img["icon"] == "Assets/Clon Notion/Àrees/_icones/x.png"     # downloaded image icon
    assert img["cover"] == "Assets/Clon Notion/Àrees/_portades/x.png"  # portada baixada
    emoji = next(p for p in pages if p["title"] == "Emoji")["metadata"]
    assert emoji["icon"] == "📌" and "cover" not in emoji              # emoji as-is, without downloading
    assert rep["attachments"] == 2                                     # only the 2 images


class FakeRestDual:
    """Projects ↔ Tasks (dual relation) fixture for inverses and warnings."""
    def __init__(self, both=True): self.both = both
    def list_users(self): return {}
    def search_databases(self): return [{"id": "proj"}, {"id": "task"}]
    def get_database(self, i):
        if i == "proj":
            return {"id": "proj", "title": [{"plain_text": "Projectes"}], "properties": {
                "Nom": {"id": "t", "type": "title", "title": {}},
                "Tasques": {"id": "r1", "type": "relation", "relation": {"database_id": "task"}}}}
        return {"id": "task", "title": [{"plain_text": "Tasques"}], "properties": {
            "Nom": {"id": "t", "type": "title", "title": {}},
            "Projecte": {"id": "r2", "type": "relation", "relation": {"database_id": "proj"}}}}
    def query_database(self, i):
        if i == "proj":
            return [{"id": "p0000000-0000-0000-0000-000000000001", "icon": None, "properties": {
                "Nom": {"type": "title", "title": [{"plain_text": "Web", "type": "text"}]},
                "Tasques": {"type": "relation", "relation": []}}}]   # empty → must receive the inverse
        return [{"id": "t0000000-0000-0000-0000-000000000002", "icon": None, "properties": {
            "Nom": {"type": "title", "title": [{"plain_text": "Disseny", "type": "text"}]},
            "Projecte": {"type": "relation", "relation": [{"id": "p0000000-0000-0000-0000-000000000001"}]}}}]


def test_clone_populates_inverse_relations():
    pages = []
    rep = clone_workspace(FakeRestDual(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                          write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                          database_ids=["proj", "task"])
    web = next(p for p in pages if p["title"] == "Web")["metadata"]
    tcid = clone_page_id("t0000000-0000-0000-0000-000000000002")
    assert web["Tasques"] == [f"[[Disseny|{tcid}]]"]   # inverse populated from Tasques.Projecte
    assert rep["warnings"] == []                        # all databases selected → no warning


def test_clone_warns_on_unselected_related_db():
    # Only "task": its Projecte field points to "proj" (not cloned) → warning.
    rep = clone_workspace(FakeRestDual(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                          write_table=lambda t: None, write_page=lambda p: None, write_view=lambda v: None,
                          database_ids=["task"])
    assert any("Projecte" in w and "unselected database" in w for w in rep["warnings"])


class FakeRestSub:
    """A row with a sub-page, and the sub-page with another one (recursion + cycle-safe)."""
    P, C, G = ("p0000000-0000-0000-0000-000000000001",
               "c0000000-0000-0000-0000-000000000002",
               "g0000000-0000-0000-0000-000000000003")
    def list_users(self): return {}
    def search_databases(self): return [{"id": "areas"}]
    def get_database(self, i):
        return {"id": "areas", "title": [{"plain_text": "Àrees"}],
                "properties": {"Nom": {"id": "t", "type": "title", "title": {}}}}
    def query_database(self, i):
        return [{"id": self.P, "icon": None, "properties": {
            "Nom": {"type": "title", "title": [{"plain_text": "Mare", "type": "text"}]}}}]
    def get_block_children(self, pid):
        if pid == self.P:
            return [{"id": self.C, "type": "child_page", "child_page": {"title": "Filla"}}]
        if pid == self.C:
            return [{"id": self.G, "type": "child_page", "child_page": {"title": "Néta"}},
                    {"id": self.P, "type": "child_page", "child_page": {"title": "Mare"}}]  # cicle
        return []
    def get_page(self, pid):
        t = {self.C: "Filla", self.G: "Néta"}.get(pid, "?")
        return {"id": pid, "icon": None,
                "properties": {"title": {"type": "title", "title": [{"plain_text": t, "type": "text"}]}}}


class FakeRestLooseViews:
    """Two loose pages: one with an embedded view, one without."""
    DB = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    def list_users(self): return {}
    def search_databases(self): return []
    def get_database(self, i): return {}
    def query_database(self, i): return []
    def get_block_children(self, pid): return []
    def get_page(self, pid):
        t = {"wiki-page": "Wiki", "dash-page": "Tauler"}.get(pid, "?")
        return {"id": pid, "icon": None,
                "properties": {"title": {"type": "title", "title": [{"plain_text": t, "type": "text"}]}}}


def test_loose_page_type_is_explicit_not_inferred_from_views():
    """Regression (bug 'DB and Wiki in Dashboards'): a loose page's type comes ONLY from
    `loose_page_types` (user's choice). Having an embedded view no longer turns it into a
    dashboard — it used to, and this sent Wiki articles (a card with a "Notes" toggle
    that embeds views) and DB containers (just the table's view) to Dashboards."""
    def fetch_page(pid):
        if pid == "dash-page":
            return ('<content>\nText\n<database url="https://notion.so/p/'
                    + FakeRestLooseViews.DB + '" inline="true"></database>\n</content>')
        return '<content>\nNomés text.\n</content>'

    # 'dash-page' DOES have an embedded view but the user has marked it 'wiki' → it must stay wiki.
    pages = []
    clone_workspace(FakeRestLooseViews(), fetch_page=fetch_page,
                    mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
                    write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                    database_ids=[], follow_subpages=False,
                    loose_page_types={"wiki-page": "wiki", "dash-page": "wiki"})
    with_views = next(p for p in pages if p["title"] == "Tauler")["metadata"]
    plain = next(p for p in pages if p["title"] == "Wiki")["metadata"]
    assert "is_dashboard" not in with_views       # has a view BUT marked 'wiki' → NOT dashboard
    assert "is_dashboard" not in plain            # wiki without a view → wiki

    # Explicitly marked 'dashboard' → it DOES go to Dashboards.
    pages2 = []
    clone_workspace(FakeRestLooseViews(), fetch_page=fetch_page,
                    mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
                    write_table=lambda t: None, write_page=pages2.append, write_view=lambda v: None,
                    database_ids=[], follow_subpages=False,
                    loose_page_types={"dash-page": "dashboard"})
    explicit = next(p for p in pages2 if p["title"] == "Tauler")["metadata"]
    assert explicit.get("is_dashboard") is True   # explicit choice 'dashboard' → Dashboards


def test_clone_follows_subpages_recursively_cycle_safe():
    pages = []
    rep = clone_workspace(FakeRestSub(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                          write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                          database_ids=["areas"])
    titles = sorted(p["title"] for p in pages)
    assert titles == ["Filla", "Mare", "Néta"]          # sub-page and sub-sub-page cloned
    assert rep["pages"] == 3                              # the cycle (Filla→Mare) doesn't duplicate any
    filla = next(p for p in pages if p["title"] == "Filla")
    assert "table_id" not in filla["metadata"]           # sub-page = standalone page (no table)
    # The hierarchy is preserved via parent_id (cf. vault_subpages_hierarchy.md): Filla hangs from
    # the Mare row, Néta of Filla; the (seed) row carries no parent_id.
    mare = next(p for p in pages if p["title"] == "Mare")
    neta = next(p for p in pages if p["title"] == "Néta")
    assert filla["metadata"]["parent_id"] == clone_page_id(FakeRestSub.P)
    assert neta["metadata"]["parent_id"] == clone_page_id(FakeRestSub.C)
    assert "parent_id" not in mare["metadata"]


class FakeRestToggleSub:
    """Sub-page NESTED inside a toggle (via `_children`) + `child_page` boundary: the block
    of Filla inside the parent also contains the nested Néta, but the Néta must be attributed to
    Filla (which the BFS visits as the parent), not to the grandparent."""
    P, C, G = ("p0000000-0000-0000-0000-000000000011",
               "c0000000-0000-0000-0000-000000000012",
               "g0000000-0000-0000-0000-000000000013")
    def list_users(self): return {}
    def search_databases(self): return [{"id": "areas"}]
    def get_database(self, i):
        return {"id": "areas", "title": [{"plain_text": "Àrees"}],
                "properties": {"Nom": {"id": "t", "type": "title", "title": {}}}}
    def query_database(self, i):
        return [{"id": self.P, "icon": None, "properties": {
            "Nom": {"type": "title", "title": [{"plain_text": "Mare", "type": "text"}]}}}]
    def get_block_children(self, pid):
        if pid == self.P:
            return [{"id": "tg", "type": "toggle", "_children": [
                {"id": self.C, "type": "child_page", "child_page": {"title": "Filla"},
                 "_children": [{"id": self.G, "type": "child_page",
                                "child_page": {"title": "Néta"}}]},
            ]}]
        if pid == self.C:
            return [{"id": self.G, "type": "child_page", "child_page": {"title": "Néta"}}]
        return []
    def get_page(self, pid):
        t = {self.C: "Filla", self.G: "Néta"}.get(pid, "?")
        return {"id": pid, "icon": None,
                "properties": {"title": {"type": "title", "title": [{"plain_text": t, "type": "text"}]}}}


def test_subpages_inside_toggles_and_child_page_boundary():
    pages = []
    clone_workspace(FakeRestToggleSub(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                    database_ids=["areas"])
    filla = next(p for p in pages if p["title"] == "Filla")
    neta = next(p for p in pages if p["title"] == "Néta")
    # Filla (inside the toggle) is discovered and hangs off the row; previously it was lost because
    # only top-level blocks were looked at.
    assert filla["metadata"]["parent_id"] == clone_page_id(FakeRestToggleSub.P)
    # Néta hangs off Filla (child_page boundary), NOT off the grandparent.
    assert neta["metadata"]["parent_id"] == clone_page_id(FakeRestToggleSub.C)


class FakeRestManyBarrenParents:
    """Many rows with NO sub-page at all: reproduces the long BFS scan (one
    get_block_children call per parent) that froze progress and heartbeat (incident 2026-07-04)."""
    N = 40
    def list_users(self): return {}
    def get_database(self, i):
        return {"id": "areas", "title": [{"plain_text": "Àrees"}],
                "properties": {"Nom": {"id": "t", "type": "title", "title": {}}}}
    def query_database(self, i):
        return [{"id": f"a{n:07d}-0000-0000-0000-000000000000", "icon": None, "properties": {
            "Nom": {"type": "title", "title": [{"plain_text": f"Fila {n}", "type": "text"}]}}}
            for n in range(self.N)]
    def get_block_children(self, pid):
        return []   # no children: previously, no emission during the whole scan


def test_subpages_scan_emits_progress_per_parent():
    events = []
    def cb(phase, done, total, report):
        events.append((phase, report.get("scan_done"), report.get("scan_total")))
    clone_workspace(FakeRestManyBarrenParents(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=lambda t: None, write_page=lambda p: None, write_view=lambda v: None,
                    database_ids=["areas"], progress_cb=cb)
    scans = [e for e in events if e[0] == "subpages"]
    # One emission PER PARENT scanned even when nothing is discovered: a liveness signal for the
    # panel/heartbeat and a checkpoint so «Abort» responds during the scan.
    n = FakeRestManyBarrenParents.N
    assert len(scans) == n
    assert [s[1] for s in scans] == list(range(1, n + 1))   # scan_done advances 1,2,…,N
    assert all(s[2] == n for s in scans)                     # total = known parents (no discovery)


def test_subpages_scan_total_grows_with_discoveries():
    events = []
    def cb(phase, done, total, report):
        events.append((phase, report.get("scan_done"), report.get("scan_total")))
    clone_workspace(FakeRestSub(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=lambda t: None, write_page=lambda p: None, write_view=lambda v: None,
                    database_ids=["areas"], progress_cb=cb)
    scans = [e for e in events if e[0] == "subpages"]
    # Seed = 1 row (Mare); Filla and Néta get discovered → 3 parents scanned in total.
    assert scans[0][2] == 1        # total inicial = llavor
    assert scans[-1][1] == 3       # the 3 parents (Mare, Filla, Néta) scanned
    assert scans[-1][2] == 3       # final total grows with the discoveries


def test_block_file_url_rest_shapes():
    from backend.services.notion_clone import block_file_url
    assert block_file_url({"type": "file", "file": {
        "type": "file", "file": {"url": "https://s3/x.doc?sig=1"}, "name": "x.doc"}}) == "https://s3/x.doc?sig=1"
    assert block_file_url({"type": "pdf", "pdf": {
        "type": "external", "external": {"url": "https://ex/a.pdf"}}}) == "https://ex/a.pdf"
    assert block_file_url({"type": "embed", "embed": {"url": "https://emb/x"}}) == "https://emb/x"
    assert block_file_url({"type": "paragraph", "paragraph": {"rich_text": []}}) is None
    assert block_file_url({}) is None and block_file_url(None) is None


def test_clone_workspace_downloads_body_attachments():
    """E2E with fakes: real-format `<file file://{json}>` tag → marker → REST signed URL →
    save_asset → local link in the written body (and counted in the report)."""
    import json as _json
    from urllib.parse import quote as _quote
    blk = "1ee268e5-2714-806a-bc67-e2b2ee6d3cbb"
    src = "file://" + _quote(_json.dumps({
        "source": "attachment:96fa413b-a330-428a-af2c-5651a2ad3250:Apunts del curs.doc",
        "permissionRecord": {"table": "block", "id": blk, "spaceId": "s"}}), safe="")
    page_mcp = f'<page><content>\nText\n<file src="{src}"></file>\n</content></page>'

    fake = FakeRest()
    fake.get_block = lambda bid: ({"type": "file", "file": {
        "type": "file", "file": {"url": "https://s3/apunts.doc?sig=x"}, "name": "Apunts del curs.doc"}}
        if bid == blk.replace("-", "") else {})
    saved = []

    def save_asset(url, prop, table):
        saved.append((url, prop, table.get("name")))
        return "Assets/Clon Notion/Projectes/_cos/apunts_ab12cd34.doc"

    pages = []
    rep = clone_workspace(
        fake, fetch_page=lambda nid: page_mcp if nid == HOST else VIEW_MD,
        mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
        write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
        database_ids=["projects", "tasks"], target_folder="Clon Notion",
        save_asset=save_asset)
    body = pages[0]["content"]
    assert "[Apunts del curs.doc](Assets/Clon Notion/Projectes/_cos/apunts_ab12cd34.doc)" in body
    assert "gnosi-notion-file" not in body and "<file" not in body
    assert saved and saved[0][0] == "https://s3/apunts.doc?sig=x"
    assert rep["attachments"] == 1 and rep["warnings"] == []


def test_clone_workspace_degrades_attachment_when_block_gone():
    """The block no longer resolves via REST → readable text + warning, never a raw marker."""
    import json as _json
    from urllib.parse import quote as _quote
    src = "file://" + _quote(_json.dumps({
        "source": "attachment:96fa413b-a330-428a-af2c-5651a2ad3250:Perdut.pdf",
        "permissionRecord": {"table": "block", "id": "1ee268e5-2714-806a-bc67-e2b2ee6d3cbb",
                             "spaceId": "s"}}), safe="")
    page_mcp = f'<page><content>\n<file src="{src}"></file>\n</content></page>'
    fake = FakeRest()
    fake.get_block = lambda bid: (_ for _ in ()).throw(RuntimeError("404 block not found"))
    pages = []
    rep = clone_workspace(
        fake, fetch_page=lambda nid: page_mcp if nid == HOST else VIEW_MD,
        mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
        write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
        database_ids=["projects", "tasks"], target_folder="Clon Notion",
        save_asset=lambda u, p, t: "mai")
    body = pages[0]["content"]
    assert "📎 Perdut.pdf" in body
    assert "gnosi-notion-file" not in body
    assert any("Perdut" not in w and "attachment" in w for w in rep["warnings"])  # per-page warning


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


class FakeRestOverride:
    """Two DBs with a dual relation: the modal's override (names WITH emoji + relation_database_id from
    NOTION) must not strip the cloned schema (regression from the Recursos bug, 2026-07-02)."""
    def __init__(self):
        self.dbs = {
            "recs": {"id": "recs", "title": [{"plain_text": "Recursos"}], "properties": {
                "Title": {"id": "t", "type": "title", "title": {}},
                "📀 Projecte": {"id": "r1", "type": "relation",
                                "relation": {"database_id": "projs"}},
            }},
            "projs": {"id": "projs", "title": [{"plain_text": "Projectes"}], "properties": {
                "Nom": {"id": "t", "type": "title", "title": {}}}},
        }
        self.rows = {
            "recs": [{"id": "11111111-1111-1111-1111-111111111111", "properties": {
                "Title": {"type": "title", "title": [{"plain_text": "Un llibre"}]},
                "📀 Projecte": {"type": "relation",
                                "relation": [{"id": "22222222-2222-2222-2222-222222222222"}]},
            }}],
            "projs": [{"id": "22222222-2222-2222-2222-222222222222", "properties": {
                "Nom": {"type": "title", "title": [{"plain_text": "El projecte"}]}}}],
        }
    def list_users(self): return {}
    def get_database(self, i): return self.dbs[i]
    def query_database(self, i):
        for r in self.rows.get(i, []):
            yield r


def test_schema_override_keeps_relations_normalized():
    from backend.services.notion_schema_config import notion_props_to_modal_schema
    from backend.services.notion_importer import map_database_schema
    # The override exactly as the modal produces it: raw names (emoji) + Notion relation ids,
    # with a real config change (storage_folder of a file field isn't needed for the regression).
    fake = FakeRestOverride()
    modal = notion_props_to_modal_schema(map_database_schema(fake.dbs["recs"]).get("properties", []))
    tables, pages = [], []
    clone_workspace(fake, fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=tables.append, write_page=pages.append,
                    write_view=lambda v: None, database_ids=["recs", "projs"],
                    target_folder="", schema_overrides={"recs": modal})
    recs = next(t for t in tables if t["name"] == "Recursos")
    rel = next(p for p in recs["properties"] if p["type"] == "relation")
    assert rel["name"] == "Projecte"                       # CLEAN name (without emoji)
    assert rel["relation_database_id"] == clone_table_id("projs")   # id from CLONE, not from Notion
    # ... and the values get remapped + decorated (no raw Notion ids are left)
    rec_page = next(p for p in pages
                    if p["metadata"].get("table_id") == recs["id"])
    v = rec_page["metadata"].get("Projecte")
    assert v == [f"[[El projecte|{clone_page_id('22222222-2222-2222-2222-222222222222')}]]"]


def test_notion_files_maps_to_valid_gnosi_type():
    """Notion 'files' → Gnosi 'files' (valid type), NEVER 'file' (singular): 'file' doesn't exist
    in the modal or in VaultTable, and it corrupted the schema when opening its config (bug 2026-07-02:
    Articles/Imatge → 'autoria')."""
    from backend.services.notion_importer import map_database_schema
    db = {"id": "d1", "title": [{"plain_text": "Articles"}], "properties": {
        "Títol": {"id": "t", "type": "title", "title": {}},
        "Imatge": {"id": "i", "type": "files", "files": {}},
    }}
    props = {p["name"]: p["type"] for p in map_database_schema(db)["properties"]}
    assert props["Imatge"] == "files"
    # and the clone keeps it valid
    t = clone_table_schema(db)
    assert next(p["type"] for p in t["properties"] if p["name"] == "Imatge") == "files"
