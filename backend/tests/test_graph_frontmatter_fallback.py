"""El graf ha de recuperar la metadata de primer nivell d'una pàgina amb YAML
malformat, IGUAL que fa el Vault (rescat tolerant compartit).

Abans, `graph_service.parse_frontmatter` tornava `{}` a qualsevol error de YAML,
de manera que una pàgina amb, p. ex., una cometa sense tancar al títol sortia
BUIDA al graf (sense títol/tipus/color) tot i llegir-se correctament al Vault.
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
    # Abans del fix: meta == {} (i el node sortia sense títol/tipus).
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
    # Ignora els membres de llista ('- item') i les línies INDENTADES ('  a: 1');
    # 'nested:' és una clau de primer nivell amb valor buit → s'inclou com a "".
    md = parse_frontmatter_fallback("id: x\nnested:\n  a: 1\n- item\nflag: false\n")
    assert md == {"id": "x", "nested": "", "flag": False}
