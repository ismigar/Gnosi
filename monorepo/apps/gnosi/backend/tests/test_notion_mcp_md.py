"""Tests del conversor MCP-markdown → Gnosi-markdown (clon fidel) amb dades REALS."""
import re
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
    assert "<database" not in out


def test_colors_become_spans():
    out = mcp_to_markdown(OCI_MCP)
    assert "{color=" not in out                                   # cap anotació crua
    assert '# <span style="background-color:#e7f3f8">Formación</span>' in out   # blue_bg
    assert '<span style="background-color:#edf3ec">Desarrolladas</span>' in out  # green_bg


def test_columns_become_fences():
    out = mcp_to_markdown(OCI_MCP)
    assert ":::column-list" in out and ":::column" in out
    assert "<column" not in out and "<columns" not in out
    # contingut de cada columna conservat sota la seva fence
    assert "- Montar en bici adaptada" in out
    assert "Desarrolladas" in out and "A desarrollar" in out


def test_mentions_become_wikilinks():
    out = mcp_to_markdown(OCI_MCP)
    assert "[[101268e52714803a95f7d0072f8a01df]]" in out
    assert "[[Àrees]]" in out


def test_no_residual_notion_tags():
    out = mcp_to_markdown(OCI_MCP)
    # cap etiqueta de Notion; els <span style> de color SÍ són vàlids a Gnosi
    for tag in ("<database", "<mention", "<columns", "<column", "<page", "<content"):
        assert tag not in out


def test_no_tabs():
    out = mcp_to_markdown(OCI_MCP)
    assert "\t" not in out
    assert "El ocio proporciona" in out


TOGGLE_MCP = (
    '<content>\n'
    '## Planificació {toggle="true"}\n'
    '\t- Tasca 1\n'
    '\t- Tasca 2\n'
    '\t\t- Subtasca\n'
    'Fora del toggle\n'
    '</content>')


def test_toggle_becomes_fence_with_children_inside():
    out = mcp_to_markdown(TOGGLE_MCP)
    lines = out.splitlines()
    assert ":::toggle-heading{level=2} Planificació" in lines
    i = lines.index(":::toggle-heading{level=2} Planificació")
    block = lines[i:]
    assert "- Tasca 1" in block and "- Tasca 2" in block       # fills dins el toggle
    assert "  - Subtasca" in block                             # nidificació preservada
    assert ":::" in block                                       # tanca
    assert "Fora del toggle" in out


CODE_MCP = (
    '<content>\n'
    'Abans\n'
    '```python\n'
    'def f(x):\n'
    '\treturn x  # {color="red"} <no-tag>\n'
    '```\n'
    'Després\n'
    '</content>')


def test_code_block_is_protected():
    out = mcp_to_markdown(CODE_MCP)
    assert "```python" in out
    assert "\treturn x  # {color=\"red\"} <no-tag>" in out   # contingut del codi intacte
    assert "Abans" in out and "Després" in out


def test_block_equation_to_latex_fence():
    out = mcp_to_markdown('<content>\nText\n$$E = mc^2$$\n</content>')
    assert "```latex" in out and "E = mc^2" in out


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
