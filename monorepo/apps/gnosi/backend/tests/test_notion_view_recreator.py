"""Tests for the view recreator (Phase 2) with REAL data from the Notion MCP."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_view_recreator import (  # noqa: E402
    parse_mcp_page, parse_mcp_view, parse_mcp_views, build_gnosi_view, resolve_filter_field,
    view_embed, recreate_views_for_page,
)

HOST_PAGE = "1d3268e52714809ab328fc33d9331454"      # Postgrau de Coaching (row from Projectes)
PROJECTES_TABLE = "8e8d3c8d38e64ea0ac417b65561c7712"  # vault table id for Projectes (= Notion db)

# --- real markdown returned by the MCP when fetching the page ---
PAGE_MD = (
    '<page url="...">\n<content>\n'
    '## Planificació {toggle="true"}\n'
    '\t### Tasques pendents\n'
    '\t<database url="https://app.notion.com/p/1d3268e5271480fbb72dcf18aacfcf8f" inline="true"></database>\n'
    '\t### Tasques acabades\n'
    '\t<database url="https://app.notion.com/p/1d3268e5271480f5baf4fb59a4227f1f" inline="true"></database>\n'
    '\t### Cronograma\n'
    '\t<database url="https://app.notion.com/p/1d3268e527148005a85dd88763bd38fd" inline="true"></database>\n'
    '## Recursos {toggle="true"}\n'
    '\t<database url="https://app.notion.com/p/1d3268e5271480f3a3d5cd8a995c6ae6" inline="true"></database>\n'
    '## Notes {toggle="true"}\n'
    '\t### Notes índex\n'
    '\t<database url="https://app.notion.com/p/1d3268e527148026bb6af8ffaab864ce" inline="true"></database>\n'
    '</content>\n</page>'
)

# --- real markdown from fetch of an embedded view (Vista de Tasques) ---
VIEW_MD = (
    'The title of this Data Source is: 📀 Tasques\n'
    '<views>\n<view url="{{view://1d3268e5-2714-80bb-b11e-000ca17d52d8}}">\n'
    '{"dataSourceUrl":"{{collection://5338cd97-037b-4ffe-b7ac-4b06b54a7639}}",'
    '"displayProperties":["Nom","Tipus","Data","📀 Projecte","Estat"],'
    '"name":"","simpleFilters":[{"filter":{"operator":"relation_contains",'
    '"property":"📀 Projecte","propertyType":"relation","type":"property",'
    '"value":{"type":"exact","value":"https://app.notion.com/p/1d3268e52714809ab328fc33d9331454"}},'
    '"id":"f01b4d8b"}],"type":"table"}\n</view>\n</views>'
)

# vault's Tasques table (relation "Projecte" points to Projectes)
TASQUES_TABLE = {
    "id": "ebe5e40f334745779d1c589de14f15a4", "name": "Tasques",
    "properties": [
        {"name": "Nom", "type": "title"},
        {"name": "Estat", "type": "status"},
        {"name": "Projecte", "type": "relation", "relation_database_id": PROJECTES_TABLE},
        {"name": "Àrea", "type": "relation", "relation_database_id": "90e31c41f815489b99f30086b120cbfa"},
    ],
}


def test_parse_mcp_page_sections():
    sec = parse_mcp_page(PAGE_MD)
    assert len(sec) == 5
    assert sec[0] == {"heading": "Tasques pendents", "db_id": "1d3268e5271480fbb72dcf18aacfcf8f"}
    assert sec[3]["heading"] == "Recursos"
    assert sec[4] == {"heading": "Notes índex", "db_id": "1d3268e527148026bb6af8ffaab864ce"}


def test_parse_mcp_view_resolves_target_and_filter():
    v = parse_mcp_view(VIEW_MD)
    assert v["data_source_name"] == "📀 Tasques"
    assert v["view_type"] == "table"
    assert "📀 Projecte" in v["display_properties"]
    assert v["filter_property"] == "📀 Projecte"
    assert v["filter_value_page_id"] == HOST_PAGE   # filters by THIS page


def test_resolve_filter_field_by_relation_target():
    # the "Projecte" relation points to Projectes (host) → it's the filter field
    assert resolve_filter_field(TASQUES_TABLE, PROJECTES_TABLE, "📀 Projecte") == "Projecte"


def test_resolve_filter_field_by_name_fallback():
    # without relation_database_id, matches by name (📀 Projecte → Projecte)
    tbl = {"properties": [{"name": "Projecte", "type": "relation"}]}
    assert resolve_filter_field(tbl, "altra-taula", "📀 Projecte") == "Projecte"


def test_build_gnosi_view_full_fidelity():
    meta = parse_mcp_view(VIEW_MD)
    view = build_gnosi_view(HOST_PAGE, TASQUES_TABLE, PROJECTES_TABLE, meta, "Tasques pendents")
    assert view["table_id"] == TASQUES_TABLE["id"]
    assert view["type"] == "table"
    assert view["name"] == "Tasques pendents"
    assert "📀 Projecte" in view["visibleProperties"]
    # the "this page" filter on the Projecte relation
    assert view["filters"] == [{"field": "Projecte", "value": "this"}]
    # contextual view marker: the dashboard doesn't show it as a tab
    assert view["embedded"] is True


def test_build_gnosi_view_deterministic_id():
    meta = parse_mcp_view(VIEW_MD)
    a = build_gnosi_view(HOST_PAGE, TASQUES_TABLE, PROJECTES_TABLE, meta, "Tasques pendents")
    b = build_gnosi_view(HOST_PAGE, TASQUES_TABLE, PROJECTES_TABLE, meta, "Tasques pendents")
    assert a["id"] == b["id"]   # idempotent (uuid5) → no duplica en re-sync


def test_view_embed_format():
    assert view_embed("v-123") == '<!-- gnosi-view:def {"view_id":"v-123"} -->'


def test_recreate_views_for_page_end_to_end():
    # fetch_view: all views resolve to the same metadata (Vista de Tasques) for the test;
    # resolve_table: "📀 Tasques"/"Tasques" → vault's Tasques table.
    def fetch_view(db_id):
        return VIEW_MD
    def resolve_table(ds_name):
        return TASQUES_TABLE if "tasques" in (ds_name or "").lower() else None
    out = recreate_views_for_page(PAGE_MD, HOST_PAGE, PROJECTES_TABLE,
                                  fetch_view=fetch_view, resolve_table=resolve_table)
    assert len(out) == 5                       # 5 embedded views on the page
    first = out[0]
    assert first["heading"] == "Tasques pendents"
    assert first["view"]["table_id"] == TASQUES_TABLE["id"]
    assert first["view"]["filters"] == [{"field": "Projecte", "value": "this"}]
    assert first["embed"].startswith('<!-- gnosi-view:def ')


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


# View with checkbox filter + sort + grouping (new MCP format, 2026-07):
# previously ONLY the "this page" relation filter was detected, and the rest were lost
# filters/sort/group (cloned views without configuration).
VIEW_MD_CHECKBOX = (
    '<database url="{{https://app.notion.com/p/a58c144f894f4a47939042b7627cd14e}}" inline="true">\n'
    'The title of this Database is: Vista de Projectes\n'
    '<data-sources>\n<data-source url="{{collection://4d490294}}">\n'
    'The title of this Data Source is: 📀 Projectes\n</data-source>\n</data-sources>\n'
    '<views>\n<view url="{{view://37b76525}}">\n'
    '{"dataSourceUrl":"{{collection://4d490294}}","displayProperties":["Nom","Arxivar"],'
    '"name":"","simpleFilters":[{"filter":{"operator":"checkbox_is","property":"Arxivar",'
    '"propertyType":"checkbox","type":"property","value":{"type":"exact","value":true}},"id":"ubDE"}],'
    '"sorts":[{"property":"Nom","direction":"descending"}],"groupBy":{"property":"Estat"},'
    '"type":"table"}\n</view>\n</views>\n</database>'
)


def test_build_gnosi_view_maps_filters_sorts_group():
    meta = parse_mcp_view(VIEW_MD_CHECKBOX)
    view = build_gnosi_view("deadbeef" * 4, {"id": "t1", "name": "Projectes", "properties": []},
                            "host-t", meta, "Projectes arxivats")
    # checkbox_is true → equals "true" (parity with the frontend's vaultFilters.asBool)
    assert view["filters"] == [{"field": "Arxivar", "operator": "equals", "value": "true"}]
    assert view["sorts"] == [{"field": "Nom", "direction": "desc"}]
    assert view["groupBy"] == "Estat"


# --- REAL multi-tab block (excerpt from the MCP fetch of «Vista de Cervell digital»,
# 2026-07-08: 10 tabs in ONE block; previously only the first one was imported) ---
VIEW_MD_MULTI = (
    '<database url="{{https://app.notion.com/p/eca38afb88a646f68e1ccfa956fc3e00}}" inline="true">\n'
    'The title of this Database is: Vista de Cervell digital\n'
    '<data-sources>\n<data-source url="{{collection://afbd0cb6-05a9-4caf-8453-9f48e3feeae1}}">\n'
    'The title of this Data Source is: 📀 Cervell digital\n</data-source>\n</data-sources>\n'
    '<views>\n'
    '<view url="{{view://7f5cd1ff-c38a-4ef9-a8cb-e22e6eeabcd5}}">\n'
    '{"dataSourceUrl":"{{collection://afbd0cb6-05a9-4caf-8453-9f48e3feeae1}}",'
    '"displayProperties":["Nota","Tipus de nota"],"name":"Taula",'
    '"sorts":[{"direction":"descending","property":"Última edició"}],"type":"table"}\n</view>\n'
    '<view url="{{view://b38dd7ae-8146-4f40-b4bd-a22d916178f9}}">\n'
    '{"dataSourceUrl":"{{collection://afbd0cb6-05a9-4caf-8453-9f48e3feeae1}}",'
    '"displayProperties":["Nota"],"groupBy":{"hideEmptyGroups":false,"property":"Tags",'
    '"propertyType":"multi_select","sort":{"type":"manual"}},"name":"Procesar per tema",'
    '"simpleFilters":[{"filter":{"operator":"enum_is","property":"Tipus de nota",'
    '"propertyType":"select","type":"property","value":{"type":"exact","value":"Nota de lectura"}},'
    '"id":"56de45e3"},{"filter":{"operator":"is_not_empty","property":"Tags",'
    '"propertyType":"multi_select","type":"property"},"id":"b2a72e8a"},'
    '{"filter":{"operator":"status_is","property":"Estat","propertyType":"status",'
    '"type":"property","value":[{"type":"is_group","value":"In progress"},'
    '{"type":"is_group","value":"To-do"}]},"id":"df42d426"}],'
    '"sorts":[{"direction":"descending","property":"Data de creació"}],"type":"board"}\n</view>\n'
    '<view url="{{view://282268e5-2714-8059-a16a-000cb30945ad}}">\n'
    '{"advancedFilter":{"filters":[{"operator":"every","property":"Centralitat",'
    '"propertyType":"formula","resultFilter":{"operator":"number_greater_than",'
    '"property":"Centralitat","propertyType":"number","type":"property",'
    '"value":{"type":"exact","value":10}},"type":"property"}],"operator":"or","type":"group"},'
    '"dataSourceUrl":"{{collection://afbd0cb6-05a9-4caf-8453-9f48e3feeae1}}",'
    '"displayProperties":["Nota"],"name":"Connexions fortes",'
    '"sorts":[{"direction":"descending","property":"Centralitat"}],"type":"table"}\n</view>\n'
    '<view url="{{view://282268e5-2714-80c1-a00e-000c5a686fbf}}">\n'
    '{"dataSourceUrl":"{{collection://afbd0cb6-05a9-4caf-8453-9f48e3feeae1}}",'
    '"displayProperties":["Nota"],"name":"Notes recents","showTable":false,'
    '"sorts":[{"direction":"descending","property":"Última edició"}],'
    '"timelineBy":"Última sincronització","type":"timeline"}\n</view>\n'
    '</views>\n</database>'
)

        # Real chart-view fixture; quoted labels are persisted data. @language-example
VIEW_MD_CHART = (
    'The title of this Data Source is: 📀 Recursos\n'
    '<views>\n<view url="{{view://9dce3651-42c0-4614-ab63-d6a1b7afb2bb}}">\n'
    '{"chartConfig":{"dataConfig":{"aggregationConfig":{"aggregation":{"aggregator":"count"},'
    '"seriesFormat":{"displayType":"bar"}},"groupBy":{"groupBy":"option","hideEmptyGroups":false,'
    '"property":"Estat","propertyType":"status","sort":{"type":"manual"}},"type":"groups_reducer"},'
    '"placeHolderType":"column","type":"bar"},'
    '"dataSourceUrl":"{{collection://1b8a282a-dd6e-4814-9140-a3014d0e411f}}",'
    '"name":"📊 Recursos per estat","simpleFilters":[{"filter":{"operator":"checkbox_is",'
    '"property":"Arxivat","propertyType":"checkbox","type":"property",'
    '"value":{"type":"exact","value":false}},"id":"@qR}"}],"type":"chart"}\n</view>\n</views>'
)


def test_parse_mcp_views_all_tabs():
    metas = parse_mcp_views(VIEW_MD_MULTI)
    assert [m["name"] for m in metas] == ["Taula", "Procesar per tema", "Connexions fortes",
                                          "Notes recents"]
    assert [m["view_type"] for m in metas] == ["table", "board", "table", "timeline"]
    assert all(m["data_source_name"] == "📀 Cervell digital" for m in metas)
    assert metas[0]["view_url"] == "7f5cd1ff-c38a-4ef9-a8cb-e22e6eeabcd5"
    # compat: parse_mcp_view = first tab
    assert parse_mcp_view(VIEW_MD_MULTI)["name"] == "Taula"


def test_parse_mcp_views_board_filters_and_group():
    board = parse_mcp_views(VIEW_MD_MULTI)[1]
    assert board["group_by"] == "Tags"
    t = {"id": "t1", "name": "Cervell digital", "properties": []}
    view = build_gnosi_view("deadbeef" * 4, t, "host-t", board, "Procesar per tema")
    # enum_is → equals; is_not_empty passes through; status by GROUPS (list) isn't mappable
    assert view["filters"] == [
        {"field": "Tipus de nota", "operator": "equals", "value": "Nota de lectura"},
        {"field": "Tags", "operator": "is_not_empty"},
    ]
    assert view["groupBy"] == "Tags"


def test_parse_mcp_views_advanced_filter_formula():
    fortes = parse_mcp_views(VIEW_MD_MULTI)[2]
    t = {"id": "t1", "name": "Cervell digital", "properties": []}
    view = build_gnosi_view("deadbeef" * 4, t, "host-t", fortes, "Connexions fortes")
    # advancedFilter with resultFilter (formula): Centralitat > 10
    assert view["filters"] == [{"field": "Centralitat", "operator": "greater_than", "value": "10"}]


def test_parse_mcp_views_timeline_datefield():
    recents = parse_mcp_views(VIEW_MD_MULTI)[3]
    assert recents["timeline_by"] == "Última sincronització"
    t = {"id": "t1", "name": "Cervell digital", "properties": []}
    view = build_gnosi_view("deadbeef" * 4, t, "host-t", recents, "Notes recents")
    assert view["type"] == "timeline"
    assert view["dateField"] == "Última sincronització"


def test_parse_mcp_views_chart_config():
    meta = parse_mcp_views(VIEW_MD_CHART)[0]
    assert meta["view_type"] == "chart"
    assert meta["chart"] == {"chartType": "bar", "xField": "Estat", "yField": None,
                             "aggregation": "count"}
    t = {"id": "t1", "name": "Recursos", "properties": []}
    view = build_gnosi_view("deadbeef" * 4, t, "host-t", meta, "📊 Recursos per estat")
    assert view["chartType"] == "bar" and view["xField"] == "Estat"
    assert view["aggregation"] == "count"
    assert view["filters"] == [{"field": "Arxivat", "operator": "equals", "value": "false"}]


def test_build_gnosi_view_salt_disambiguates_ids():
    metas = parse_mcp_views(VIEW_MD_MULTI)
    t = {"id": "t1", "name": "Cervell digital", "properties": []}
    v0 = build_gnosi_view("deadbeef" * 4, t, "host-t", metas[0], "Secció")
    v0b = build_gnosi_view("deadbeef" * 4, t, "host-t", metas[0], "Secció")
    v1 = build_gnosi_view("deadbeef" * 4, t, "host-t", metas[1], "Secció",
                          salt=metas[1]["view_url"])
    assert v0["id"] == v0b["id"]          # no salt: deterministic (legacy id)
    assert v1["id"] != v0["id"]           # tabs 2..N: own id


def test_recreate_views_for_page_multi_tab():
    page_md = ('<content>\n### Cervell\n'
               '<database url="https://app.notion.com/p/eca38afb88a646f68e1ccfa956fc3e00" '
               'inline="true"></database>\n</content>')
    t = {"id": "t1", "name": "Cervell digital", "properties": []}
    res = recreate_views_for_page(
        page_md, "deadbeef" * 4, "host-t",
        fetch_view=lambda db_id: VIEW_MD_MULTI,
        resolve_table=lambda name: t if "Cervell" in (name or "") else None)
    assert len(res) == 4                                  # ALL tabs
    assert len({r["view"]["id"] for r in res}) == 4       # unique ids
    assert [r["view"]["name"] for r in res] == ["Taula", "Procesar per tema",
                                                "Connexions fortes", "Notes recents"]
    # Only the ANCHOR carries the embed; the rest hang off it via the `tabs` field (tabs)
    assert res[0]["embed"] and all(r["embed"] is None for r in res[1:])
    assert res[0]["view"]["tabs"] == [r["view"]["id"] for r in res[1:]]
