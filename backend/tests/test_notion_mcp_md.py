"""Tests for the MCP-markdown → Gnosi-markdown converter (faithful clone) with REAL data."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_mcp_md import mcp_to_markdown, extract_db_ids  # noqa: E402

# REAL fragment of what the MCP returns for the page "📌 Ocio"
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
    assert "{color=" not in out                                   # no raw annotation
    assert '# <span style="background-color:#e7f3f8">Formación</span>' in out   # blue_bg
    assert '<span style="background-color:#edf3ec">Desarrolladas</span>' in out  # green_bg


def test_columns_become_fences():
    out = mcp_to_markdown(OCI_MCP)
    assert ":::column-list" in out and ":::column" in out
    assert "<column" not in out and "<columns" not in out
    # content of each column preserved under its fence
    assert "- Montar en bici adaptada" in out
    assert "Desarrolladas" in out and "A desarrollar" in out


def test_mentions_become_wikilinks():
    out = mcp_to_markdown(OCI_MCP)
    assert "[[101268e52714803a95f7d0072f8a01df]]" in out
    assert "[[Àrees]]" in out


def test_no_residual_notion_tags():
    out = mcp_to_markdown(OCI_MCP)
    # no Notion tag; color <span style> tags ARE valid in Gnosi
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
    assert "- Tasca 1" in block and "- Tasca 2" in block       # children inside the toggle
    assert "  - Subtasca" in block                             # nesting preserved
    assert ":::" in block                                       # closes
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
    assert "\treturn x  # {color=\"red\"} <no-tag>" in out   # code content intact
    assert "Abans" in out and "Després" in out


def test_block_equation_to_latex_fence():
    out = mcp_to_markdown('<content>\nText\n$$E = mc^2$$\n</content>')
    assert "```latex" in out and "E = mc^2" in out


def test_subpage_tags_become_wikilinks():
    md = ('<content>\n'
          '<page url="https://app.notion.com/p/877725a8de414f028cb8445686c10377">Jesús?</page>\n'
          '<page url="https://app.notion.com/p/9bde8a165b8b49ef8bcf2afc30a36581"/>\n'
          '</content>')
    out = mcp_to_markdown(md)
    assert "[[Jesús?]]" in out                                   # with title → [[Title]]
    assert "[[9bde8a165b8b49ef8bcf2afc30a36581]]" in out         # auto-tancat → [[id]]
    assert "<page" not in out                                    # no raw tag


# REAL attachment src from «Curs de narrativa i conte I, II» (BD/Recursos): the raw tags
# reached the vault and BlockNote dropped all 171 on the first save (incident 2026-07-19).
ATT_SRC = (
    "file://%7B%22source%22%3A%22attachment%3A96fa413b-a330-428a-af2c-5651a2ad3250"
    "%3AEE_ismaelGarcia_incipit2012.doc%22%2C%22permissionRecord%22%3A%7B%22table%22"
    "%3A%22block%22%2C%22id%22%3A%221ee268e5-2714-806a-bc67-e2b2ee6d3cbb%22%2C%22spaceId"
    "%22%3A%22981765aa-6b61-4904-b7b5-2ff9c372bc7c%22%7D%7D")
ATT_MARKER = ("<!-- gnosi-notion-file:1ee268e52714806abc67e2b2ee6d3cbb:"
              "EE_ismaelGarcia_incipit2012.doc -->")


def test_attachment_file_tag_becomes_marker():
    out = mcp_to_markdown(f'<content>\nAbans\n<file src="{ATT_SRC}"></file>\nDesprés\n</content>')
    assert ATT_MARKER in out
    assert "<file" not in out and "permissionRecord" not in out
    assert "Abans" in out and "Després" in out


def test_attachment_media_variants_become_markers():
    # <pdf>/<video>/<audio>/<embed> share the tag shape → same handling (incl. self-closing)
    md = (f'<content>\n<pdf src="{ATT_SRC}">Apunts</pdf>\n<video src="{ATT_SRC}"/>\n</content>')
    out = mcp_to_markdown(md)
    assert out.count("gnosi-notion-file:1ee268e52714806abc67e2b2ee6d3cbb") == 2
    assert "<pdf" not in out and "<video" not in out


def test_external_file_tag_becomes_link():
    out = mcp_to_markdown(
        '<content>\n<file src="https://example.com/docs/Guia%20r%C3%A0pida.pdf"></file>\n'
        '<file src="https://example.com/a.zip">Material del curs</file>\n</content>')
    assert "[Guia ràpida.pdf](https://example.com/docs/Guia%20r%C3%A0pida.pdf)" in out
    assert "[Material del curs](https://example.com/a.zip)" in out
    assert "<file" not in out


def test_unresolvable_file_tag_degrades_to_readable_text():
    out = mcp_to_markdown(
        '<content>\n<file src="file-upload://xyz">Esborrany</file>\n'
        '<file src="file://no-json-aqui"></file>\n</content>')
    assert "📎 Esborrany" in out
    assert "📎 fitxer adjunt" in out
    assert "<file" not in out


# REAL block-toggle fragment (new MCP format: <details>/<summary>, unindented children)
DETAILS_MCP = (
    '<content>\n'
    '<details>\n'
    '<summary>Unitat 1 - La construcció del conte I. Pensar el conte</summary>\n'
    f'<file src="{ATT_SRC}"></file>\n'
    '- Nota de la unitat\n'
    '</details>\n'
    'Fora del toggle\n'
    '</content>')


def test_details_summary_becomes_toggle_fence():
    out = mcp_to_markdown(DETAILS_MCP)
    lines = out.splitlines()
    assert ":::toggle Unitat 1 - La construcció del conte I. Pensar el conte" in lines
    i = lines.index(":::toggle Unitat 1 - La construcció del conte I. Pensar el conte")
    block = lines[i:]
    assert ATT_MARKER in block                      # attachment marker INSIDE the toggle
    assert "- Nota de la unitat" in block
    assert ":::" in block                            # closes
    assert "Fora del toggle" in out
    for tag in ("<details", "<summary", "</details", "</summary"):
        assert tag not in out


def test_details_with_color_wraps_title():
    out = mcp_to_markdown('<content>\n<details color="blue_bg">\n<summary>Recursos</summary>\n'
                          'contingut\n</details>\n</content>')
    assert ':::toggle <span style="background-color:#e7f3f8">Recursos</span>' in out
    assert "contingut" in out and "<details" not in out


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
