"""Unit tests for the translate_page markdown segmenter.

Run from `Gnosi`:

    python3 -m pytest pipeline/skills/translate_page/scripts/test_markdown_segmenter.py -v

A fake translator wraps natural-language text in « » so each assertion can tell what was
translated apart from what was preserved verbatim. No network is used.
"""
from pipeline.skills.translate_page.scripts.markdown_segmenter import (
    translate_markdown,
    translate_title,
)


def _fake(text, src, tgt):
    return f"«{text}»", "fake"


def tr(body):
    out, providers = translate_markdown(body, "ca", "en", translate_fn=_fake)
    return out


# --- Plain text & line markers --------------------------------------------------------


def test_paragraph_translated():
    assert tr("Hola món") == "«Hola món»"


def test_heading_marker_preserved():
    assert tr("## Títol de secció") == "## «Títol de secció»"


def test_bullet_marker_preserved():
    assert tr("- un element") == "- «un element»"


def test_nested_bullet_indentation_preserved():
    assert tr("    - element niuat") == "    - «element niuat»"


def test_numbered_marker_preserved():
    assert tr("1. primer") == "1. «primer»"


def test_checklist_marker_preserved():
    assert tr("- [ ] tasca pendent") == "- [ ] «tasca pendent»"
    assert tr("- [x] tasca feta") == "- [x] «tasca feta»"


def test_blockquote_marker_preserved():
    assert tr("> una cita") == "> «una cita»"


def test_callout_header_preserved():
    out = tr("> [!info] Atenció")
    assert out == "> [!info] «Atenció»"


# --- Passthrough blocks (never translated) --------------------------------------------


def test_code_fence_passthrough():
    src = '```python\nprint("hola")\n```'
    assert tr(src) == src


def test_gnosi_database_fence_passthrough():
    src = '```gnosi-database\n{\n  "table_id": "abc",\n  "title": "Recursos"\n}\n```'
    assert tr(src) == src


def test_gnosi_view_fence_passthrough():
    src = '```gnosi-view\n{\n  "view_id": "v1",\n  "heading": "Registres"\n}\n```'
    assert tr(src) == src


def test_bibliography_passthrough():
    assert tr("{{bibliography}}") == "{{bibliography}}"
    assert tr("{{bibliography:apa}}") == "{{bibliography:apa}}"
    assert tr("{{bibliography:apa:ca-AD}}") == "{{bibliography:apa:ca-AD}}"


def test_transclusion_line_passthrough():
    assert tr("![[document-id]]") == "![[document-id]]"
    assert tr("![[document-id|Àlies]]") == "![[document-id|Àlies]]"
    assert tr("![[document-id#secció|Àlies]]") == "![[document-id#secció|Àlies]]"


def test_horizontal_rule_passthrough():
    assert tr("---") == "---"


def test_directive_markers_passthrough():
    src = ":::column-list\n:::column {width=0.5}\nContingut\n:::\n:::"
    out = tr(src)
    lines = out.split("\n")
    assert lines[0] == ":::column-list"
    assert lines[1] == ":::column {width=0.5}"
    assert lines[2] == "«Contingut»"  # inner content IS translated
    assert lines[3] == ":::"
    assert lines[4] == ":::"


def test_toggle_label_translated_marker_preserved():
    assert tr(":::toggle Obre'm") == ":::toggle «Obre'm»"


def test_gnosi_ignore_block_passthrough():
    src = ":::gnosi-ignore\nText que NO s'ha de traduir\n:::"
    assert tr(src) == src


# --- Inline protection ----------------------------------------------------------------


def test_inline_code_preserved():
    out = tr("Executa `npm run build` ara")
    assert "`npm run build`" in out
    assert out == "«Executa `npm run build` ara»"


def test_link_text_translated_url_preserved():
    out = tr("Vegeu [la guia](https://example.com/path) per saber-ne més")
    assert "(https://example.com/path)" in out
    assert "[la guia]" in out  # brackets survive; inner text rides along in « »


def test_image_preserved():
    out = tr("Mira ![diagrama](https://img.example/a.png) aquí")
    assert "![diagrama](https://img.example/a.png)" in out


def test_file_sentinel_url_preserved():
    url = "https://gnosi-file-protocol.local/Users/x/doc.pdf"
    out = tr(f"Obre [el fitxer]({url})")
    assert f"({url})" in out


def test_wikilink_preserved():
    out = tr("Consulta [[altra-pagina]] també")
    assert "[[altra-pagina]]" in out


def test_wikilink_with_alias_preserved():
    out = tr("Consulta [[altra-pagina|el resum]] també")
    assert "[[altra-pagina|el resum]]" in out


def test_bracket_citation_preserved():
    out = tr("Com diu [@smith2020] al seu treball")
    assert "[@smith2020]" in out


def test_naked_citation_preserved():
    out = tr("Com diu @smith2020 al seu treball")
    assert "@smith2020" in out


def test_html_tags_preserved():
    out = tr("Primera línia<br>\nsegona")
    assert "<br>" in out


def test_line_with_only_image_not_wrapped():
    # No translatable text remains after protection → returned untouched.
    assert tr("![sol](https://img.example/x.png)") == "![sol](https://img.example/x.png)"


# --- GFM tables -----------------------------------------------------------------------


def test_table_cells_translated_separator_intact():
    src = "| Nom | Edat |\n| --- | --- |\n| Anna | 30 |"
    out = tr(src)
    lines = out.split("\n")
    assert lines[0] == "| «Nom» | «Edat» |"
    assert lines[1] == "| --- | --- |"  # separator untouched
    # "30" is digits-only → no natural-language text → left untranslated.
    assert lines[2] == "| «Anna» | 30 |"


# --- Whole-document round trip --------------------------------------------------------


def test_complex_document_structure_preserved():
    src = "\n".join([
        "# Introducció",
        "",
        "Un paràgraf amb [[enllaç]] i una cita [@ref2020].",
        "",
        "```gnosi-database",
        '{"table_id": "t1"}',
        "```",
        "",
        ":::column-list",
        ":::column {width=0.5}",
        "Columna esquerra",
        ":::",
        ":::",
        "",
        "{{bibliography:apa}}",
    ])
    out = tr(src)
    # Structural lines are byte-identical.
    assert "```gnosi-database" in out
    assert '{"table_id": "t1"}' in out
    assert ":::column {width=0.5}" in out
    assert "{{bibliography:apa}}" in out
    assert "[[enllaç]]" in out
    assert "[@ref2020]" in out
    # Natural text was translated.
    assert "# «Introducció»" in out
    assert "«Columna esquerra»" in out
    # Same number of lines (no structural drift).
    assert len(out.split("\n")) == len(src.split("\n"))


# --- Guards ---------------------------------------------------------------------------


def test_same_lang_is_noop():
    body = "# Títol\nText"
    out, providers = translate_markdown(body, "ca", "ca", translate_fn=_fake)
    assert out == body
    assert providers == set()


def test_empty_body():
    out, providers = translate_markdown("", "ca", "en", translate_fn=_fake)
    assert out == ""


def test_translate_title_plain():
    out, provider = translate_title("El meu document", "ca", "en", translate_fn=_fake)
    assert out == "«El meu document»"
    assert provider == "fake"


def test_translate_title_same_lang_noop():
    out, provider = translate_title("Títol", "ca", "ca", translate_fn=_fake)
    assert out == "Títol"
    assert provider == "noop"
