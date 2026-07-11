"""The graph must recover the top-level metadata of a page with malformed YAML,
JUST LIKE the Vault does (shared tolerant rescue).

Before, `graph_service.parse_frontmatter` returned `{}` on any YAML error,
so a page with, e.g., an unclosed quote in the title came out
EMPTY in the graph (no title/type/color) even though it read correctly in the Vault.
"""
from backend.services.graph_service import parse_frontmatter
from backend.services.frontmatter_fallback import parse_frontmatter_fallback


MALFORMED = (
    "---\n"
    'id: abc123\n'
    'title: "títol amb cometa sense tancar\n'   # ← YAMLError
    "Item Type: book\n"
    "is_hub: true\n"
    "---\n"
    "Cos de la nota.\n"
)


def test_graf_recupera_metadata_de_yaml_malformat():
    meta, body = parse_frontmatter(MALFORMED)
    # Before the fix: meta == {} (and the node came out without title/type).
    assert meta.get("id") == "abc123"
    assert meta.get("Item Type") == "book"
    assert meta.get("is_hub") is True
    assert "títol" in str(meta.get("title", ""))
    assert body.strip() == "Cos de la nota."


def test_yaml_valid_no_passa_pel_fallback():
    valid = "---\nid: n1\ntitle: Hola\ncount: 3\n---\ncos\n"
    meta, _ = parse_frontmatter(valid)
    assert meta == {"id": "n1", "title": "Hola", "count": 3}


def test_sense_frontmatter_retorna_buit():
    meta, body = parse_frontmatter("Només cos, sense frontmatter.\n")
    assert meta == {}
    assert body == "Només cos, sense frontmatter.\n"


def test_fallback_pur_salva_escalars_de_primer_nivell():
    # Ignores list members ('- item') and INDENTED lines ('  a: 1');
    # 'nested:' is a top-level key with an empty value → it's included as "".
    md = parse_frontmatter_fallback("id: x\nnested:\n  a: 1\n- item\nflag: false\n")
    assert md == {"id": "x", "nested": "", "flag": False}
