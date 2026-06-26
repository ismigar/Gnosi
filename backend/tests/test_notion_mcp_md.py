"""Tests del conversor MCP-markdown → Gnosi-markdown amb dades REALS (pàgina Oci)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_mcp_md import mcp_to_markdown, extract_db_ids  # noqa: E402

# Fragment REAL del que retorna l'MCP per a la pàgina "📌 Ocio"
OCI_MCP = (
    '<page url="...">\n<content>\n'
    '# Formación {color="blue_bg"}\n'
    '<database url="https://app.notion.com/p/2a6b116904844d81a7a382a809a590f6" inline="true"></database>\n'
    '# Experiencia profesional {color="pink_bg"}\n'
    '<database url="https://app.notion.com/p/7d1c70ce8c0a4cb7844d635485993bc1" inline="true"></database>\n'
    '# Competencias {color="brown_bg"}\n'
    '<columns>\n'
    '\t<column>\n'
    '\t\t## Desarrolladas {color="green_bg"}\n'
    '\t\t- Montar en bici adaptada\n'
    '\t\t- Iniciativa\n'
    '\t</column>\n'
    '\t<column>\n'
    '\t\t## A desarrollar {color="red_bg"}\n'
    '\t</column>\n'
    '</columns>\n'
    '# Como contribuyen a <mention-page url="https://app.notion.com/p/101268e52714803a95f7d0072f8a01df"/> :\n'
    'El ocio proporciona un espacio fundamental para el descanso.\n'
    '- Àrees → <mention-page url="https://app.notion.com/p/90e31c41f815489b99f30086b120cbfa">Àrees</mention-page>\n'
    '</content>\n</page>'
)


def test_extract_db_ids_in_order():
    ids = extract_db_ids(OCI_MCP)
    assert ids[:2] == ["2a6b116904844d81a7a382a809a590f6", "7d1c70ce8c0a4cb7844d635485993bc1"]


def test_databases_become_view_markers():
    out = mcp_to_markdown(OCI_MCP)
    assert "<!-- gnosi-notion-db:2a6b116904844d81a7a382a809a590f6 -->" in out
    assert "<!-- gnosi-notion-db:7d1c70ce8c0a4cb7844d635485993bc1 -->" in out
    assert "<database" not in out  # cap etiqueta de BD crua


def test_color_and_toggle_annotations_stripped():
    out = mcp_to_markdown(OCI_MCP)
    assert "{color=" not in out
    assert "# Formación" in out and "# Competencias" in out


def test_columns_flattened_content_preserved():
    out = mcp_to_markdown(OCI_MCP)
    assert "<column" not in out and "<columns" not in out
    assert "## Desarrolladas" in out
    assert "- Montar en bici adaptada" in out   # contingut de la columna conservat
    assert "## A desarrollar" in out


def test_mentions_become_wikilinks():
    out = mcp_to_markdown(OCI_MCP)
    # menció auto-tancada → [[id]]
    assert "[[101268e52714803a95f7d0072f8a01df]]" in out
    # menció amb text → [[Text]]
    assert "[[Àrees]]" in out


def test_no_residual_tags():
    out = mcp_to_markdown(OCI_MCP)
    import re
    assert not re.search(r"<[a-zA-Z/][^>]*>", out)   # cap etiqueta residual


def test_dedented_and_clean():
    out = mcp_to_markdown(OCI_MCP)
    assert "\t" not in out                       # tabs desfets
    assert "El ocio proporciona" in out


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
