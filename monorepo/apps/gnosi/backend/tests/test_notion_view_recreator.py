"""Tests del recreador de vistes (Fase 2) amb dades REALS de l'MCP de Notion."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_view_recreator import (  # noqa: E402
    parse_mcp_page, parse_mcp_view, build_gnosi_view, resolve_filter_field, view_embed,
    recreate_views_for_page,
)

HOST_PAGE = "1d3268e52714809ab328fc33d9331454"      # Postgrau de Coaching (fila de Projectes)
PROJECTES_TABLE = "8e8d3c8d38e64ea0ac417b65561c7712"  # id taula vault Projectes (= db Notion)

# --- markdown real retornat per l'MCP en fer fetch de la pàgina ---
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

# --- markdown real de fetch d'una vista incrustada (Vista de Tasques) ---
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

# taula Tasques del vault (relació "Projecte" apunta a Projectes)
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
    assert v["filter_value_page_id"] == HOST_PAGE   # filtra per AQUESTA pàgina


def test_resolve_filter_field_by_relation_target():
    # la relació "Projecte" apunta a Projectes (host) → és el camp del filtre
    assert resolve_filter_field(TASQUES_TABLE, PROJECTES_TABLE, "📀 Projecte") == "Projecte"


def test_resolve_filter_field_by_name_fallback():
    # sense relation_database_id, casa pel nom (📀 Projecte → Projecte)
    tbl = {"properties": [{"name": "Projecte", "type": "relation"}]}
    assert resolve_filter_field(tbl, "altra-taula", "📀 Projecte") == "Projecte"


def test_build_gnosi_view_full_fidelity():
    meta = parse_mcp_view(VIEW_MD)
    view = build_gnosi_view(HOST_PAGE, TASQUES_TABLE, PROJECTES_TABLE, meta, "Tasques pendents")
    assert view["table_id"] == TASQUES_TABLE["id"]
    assert view["type"] == "table"
    assert view["name"] == "Tasques pendents"
    assert "📀 Projecte" in view["visibleProperties"]
    # el filtre "aquesta pàgina" sobre la relació Projecte
    assert view["filters"] == [{"field": "Projecte", "value": "this"}]


def test_build_gnosi_view_deterministic_id():
    meta = parse_mcp_view(VIEW_MD)
    a = build_gnosi_view(HOST_PAGE, TASQUES_TABLE, PROJECTES_TABLE, meta, "Tasques pendents")
    b = build_gnosi_view(HOST_PAGE, TASQUES_TABLE, PROJECTES_TABLE, meta, "Tasques pendents")
    assert a["id"] == b["id"]   # idempotent (uuid5) → no duplica en re-sync


def test_view_embed_format():
    assert view_embed("v-123") == '<!-- gnosi-view:def {"view_id":"v-123"} -->'


def test_recreate_views_for_page_end_to_end():
    # fetch_view: totes les vistes resolen a la mateixa metadada (Vista de Tasques) per al test;
    # resolve_table: "📀 Tasques"/"Tasques" → taula Tasques del vault.
    def fetch_view(db_id):
        return VIEW_MD
    def resolve_table(ds_name):
        return TASQUES_TABLE if "tasques" in (ds_name or "").lower() else None
    out = recreate_views_for_page(PAGE_MD, HOST_PAGE, PROJECTES_TABLE,
                                  fetch_view=fetch_view, resolve_table=resolve_table)
    assert len(out) == 5                       # 5 vistes incrustades a la pàgina
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
