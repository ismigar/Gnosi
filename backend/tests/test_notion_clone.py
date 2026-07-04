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


class FakeRestAreas:
    """BD amb camp d'emoji, relació i created_time per provar neteja+decoració+dates."""
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
    assert "Projectes" in m and "📀 Projectes" not in m          # emoji tret del nom de camp
    oci = clone_page_id("22222222-2222-2222-2222-222222222222")
    assert m["Projectes"] == [f"[[Oci|{oci}]]"]                  # relació decorada (forward ref)
    assert m["Data de creació"] == "2025-04-11T16:22:00.000Z"    # data TAL QUAL (es preserva l'hora)


class FakeRestIcons:
    """Pàgines amb icona d'imatge / emoji i portada, per provar la baixada d'icones+portades."""
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
    assert img["icon"] == "Assets/Clon Notion/Àrees/_icones/x.png"     # icona d'imatge baixada
    assert img["cover"] == "Assets/Clon Notion/Àrees/_portades/x.png"  # portada baixada
    emoji = next(p for p in pages if p["title"] == "Emoji")["metadata"]
    assert emoji["icon"] == "📌" and "cover" not in emoji              # emoji tal qual, sense baixar
    assert rep["attachments"] == 2                                     # només les 2 imatges


class FakeRestDual:
    """Projectes ↔ Tasques (relació dual) per provar inversos i avisos."""
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
                "Tasques": {"type": "relation", "relation": []}}}]   # buit → ha de rebre l'invers
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
    assert web["Tasques"] == [f"[[Disseny|{tcid}]]"]   # invers poblat des de Tasques.Projecte
    assert rep["warnings"] == []                        # totes les BD seleccionades → cap avís


def test_clone_warns_on_unselected_related_db():
    # Només "task": el seu camp Projecte apunta a "proj" (no clonada) → avís
    rep = clone_workspace(FakeRestDual(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                          write_table=lambda t: None, write_page=lambda p: None, write_view=lambda v: None,
                          database_ids=["task"])
    assert any("Projecte" in w and "no seleccionada" in w for w in rep["warnings"])


class FakeRestSub:
    """Una fila amb sub-pàgina, i la sub-pàgina amb una altra (recursió + cicle-safe)."""
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
    """Dues pàgines soltes: una amb vista incrustada, una sense."""
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
    """Regressió (bug 'BD i Wiki a Taulells'): el tipus d'una pàgina solta ve NOMÉS de
    `loose_page_types` (tria de l'usuari). Tenir una vista incrustada ja NO la converteix en
    dashboard — abans sí, i això enviava articles del Wiki (una carta amb un toggle "Notes"
    que incrusta vistes) i contenidors de BD (només el view de la taula) a Taulells."""
    def fetch_page(pid):
        if pid == "dash-page":
            return ('<content>\nText\n<database url="https://notion.so/p/'
                    + FakeRestLooseViews.DB + '" inline="true"></database>\n</content>')
        return '<content>\nNomés text.\n</content>'

    # 'dash-page' TÉ vista incrustada però l'usuari l'ha marcada 'wiki' → ha de quedar wiki.
    pages = []
    clone_workspace(FakeRestLooseViews(), fetch_page=fetch_page,
                    mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
                    write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                    database_ids=[], follow_subpages=False,
                    loose_page_types={"wiki-page": "wiki", "dash-page": "wiki"})
    with_views = next(p for p in pages if p["title"] == "Tauler")["metadata"]
    plain = next(p for p in pages if p["title"] == "Wiki")["metadata"]
    assert "is_dashboard" not in with_views       # té vista PERÒ marcada 'wiki' → NO dashboard
    assert "is_dashboard" not in plain            # wiki sense vista → wiki

    # Marcada 'dashboard' explícitament → SÍ va a Taulells.
    pages2 = []
    clone_workspace(FakeRestLooseViews(), fetch_page=fetch_page,
                    mcp_to_markdown=notion_mcp_md.mcp_to_markdown,
                    write_table=lambda t: None, write_page=pages2.append, write_view=lambda v: None,
                    database_ids=[], follow_subpages=False,
                    loose_page_types={"dash-page": "dashboard"})
    explicit = next(p for p in pages2 if p["title"] == "Tauler")["metadata"]
    assert explicit.get("is_dashboard") is True   # tria explícita 'dashboard' → Taulells


def test_clone_follows_subpages_recursively_cycle_safe():
    pages = []
    rep = clone_workspace(FakeRestSub(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                          write_table=lambda t: None, write_page=pages.append, write_view=lambda v: None,
                          database_ids=["areas"])
    titles = sorted(p["title"] for p in pages)
    assert titles == ["Filla", "Mare", "Néta"]          # sub-pàgina i sub-sub-pàgina clonades
    assert rep["pages"] == 3                              # el cicle (Filla→Mare) no en duplica cap
    filla = next(p for p in pages if p["title"] == "Filla")
    assert "table_id" not in filla["metadata"]           # sub-pàgina = pàgina autònoma (sense taula)
    # La jerarquia es conserva via parent_id (cf. vault_subpages_hierarchy.md): Filla penja de
    # la fila Mare, Néta de Filla; la fila (llavor) no porta parent_id.
    mare = next(p for p in pages if p["title"] == "Mare")
    neta = next(p for p in pages if p["title"] == "Néta")
    assert filla["metadata"]["parent_id"] == clone_page_id(FakeRestSub.P)
    assert neta["metadata"]["parent_id"] == clone_page_id(FakeRestSub.C)
    assert "parent_id" not in mare["metadata"]


class FakeRestToggleSub:
    """Sub-pàgina NIADA dins d'un toggle (via `_children`) + frontera de `child_page`: el bloc
    de la Filla dins del pare també conté la Néta niada, però la Néta s'ha d'atribuir a la
    Filla (que el BFS visita com a pare), no a l'avi."""
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
    # La Filla (dins del toggle) es descobreix i penja de la fila; abans es perdia perquè
    # només es miraven els blocs de primer nivell.
    assert filla["metadata"]["parent_id"] == clone_page_id(FakeRestToggleSub.P)
    # La Néta penja de la Filla (frontera de child_page), NO de l'avi.
    assert neta["metadata"]["parent_id"] == clone_page_id(FakeRestToggleSub.C)


class FakeRestManyBarrenParents:
    """Moltes files sense CAP subpàgina: reprodueix l'escaneig llarg del BFS (una crida
    get_block_children per pare) que congelava progrés i heartbeat (incident 2026-07-04)."""
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
        return []   # cap fill: abans, cap emissió durant tot l'escaneig


def test_subpages_scan_emits_progress_per_parent():
    events = []
    def cb(phase, done, total, report):
        events.append((phase, report.get("scan_done"), report.get("scan_total")))
    clone_workspace(FakeRestManyBarrenParents(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=lambda t: None, write_page=lambda p: None, write_view=lambda v: None,
                    database_ids=["areas"], progress_cb=cb)
    scans = [e for e in events if e[0] == "subpages"]
    # Una emissió PER PARE escanejat encara que no es descobreixi res: senyal de vida per al
    # panell/heartbeat i punt de control perquè «Avortar» respongui durant l'escaneig.
    n = FakeRestManyBarrenParents.N
    assert len(scans) == n
    assert [s[1] for s in scans] == list(range(1, n + 1))   # scan_done avança 1,2,…,N
    assert all(s[2] == n for s in scans)                     # total = pares coneguts (cap descoberta)


def test_subpages_scan_total_grows_with_discoveries():
    events = []
    def cb(phase, done, total, report):
        events.append((phase, report.get("scan_done"), report.get("scan_total")))
    clone_workspace(FakeRestSub(), fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=lambda t: None, write_page=lambda p: None, write_view=lambda v: None,
                    database_ids=["areas"], progress_cb=cb)
    scans = [e for e in events if e[0] == "subpages"]
    # Llavor = 1 fila (Mare); es descobreixen Filla i Néta → s'escanegen 3 pares en total.
    assert scans[0][2] == 1        # total inicial = llavor
    assert scans[-1][1] == 3       # els 3 pares (Mare, Filla, Néta) escanejats
    assert scans[-1][2] == 3       # total final creix amb les descobertes


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
    """Dues BD amb relació dual: l'override del modal (noms AMB emoji + relation_database_id de
    NOTION) no ha de despullar l'esquema clonat (regressió del bug de Recursos, 2026-07-02)."""
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
    # L'override tal com el produeix el modal: noms crus (emoji) + ids de relació de Notion,
    # amb un canvi de config real (storage_folder d'un camp d'arxiu no cal per la regressió).
    fake = FakeRestOverride()
    modal = notion_props_to_modal_schema(map_database_schema(fake.dbs["recs"]).get("properties", []))
    tables, pages = [], []
    clone_workspace(fake, fetch_page=lambda i: "", mcp_to_markdown=lambda m: "",
                    write_table=tables.append, write_page=pages.append,
                    write_view=lambda v: None, database_ids=["recs", "projs"],
                    target_folder="", schema_overrides={"recs": modal})
    recs = next(t for t in tables if t["name"] == "Recursos")
    rel = next(p for p in recs["properties"] if p["type"] == "relation")
    assert rel["name"] == "Projecte"                       # nom NET (sense emoji)
    assert rel["relation_database_id"] == clone_table_id("projs")   # id de CLON, no de Notion
    # ... i els valors es remapen + decoren (no queden ids de Notion crus)
    rec_page = next(p for p in pages
                    if p["metadata"].get("table_id") == recs["id"])
    v = rec_page["metadata"].get("Projecte")
    assert v == [f"[[El projecte|{clone_page_id('22222222-2222-2222-2222-222222222222')}]]"]


def test_notion_files_maps_to_valid_gnosi_type():
    """Notion 'files' → Gnosi 'files' (tipus vàlid), MAI 'file' (singular): 'file' no existeix
    al modal ni a VaultTable i corrompia l'esquema en obrir-ne la config (bug 2026-07-02:
    Articles/Imatge → 'autoria')."""
    from backend.services.notion_importer import map_database_schema
    db = {"id": "d1", "title": [{"plain_text": "Articles"}], "properties": {
        "Títol": {"id": "t", "type": "title", "title": {}},
        "Imatge": {"id": "i", "type": "files", "files": {}},
    }}
    props = {p["name"]: p["type"] for p in map_database_schema(db)["properties"]}
    assert props["Imatge"] == "files"
    # i el clon el manté vàlid
    t = clone_table_schema(db)
    assert next(p["type"] for p in t["properties"] if p["name"] == "Imatge") == "files"
