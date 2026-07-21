"""`block_to_md` (Notion import) must:
- escape `|` (and collapse line breaks) in `table_row` cells, or a
  cell with a `|` breaks the imported GFM table structure;
- serialize `code` blocks with the LITERAL text (without applying the
  bold/link/`code` annotations, which used to show up as Markdown marks inside the
  code).
"""
from backend.services.notion_importer import block_to_md


def _rt(text, **ann):
    r = {"plain_text": text, "annotations": ann}
    return r


def test_table_row_escapa_pipe_i_col·lapsa_salts():
    block = {
        "type": "table_row",
        "table_row": {"cells": [
            [_rt("a|b")],
            [_rt("línia1\nlínia2")],
            [_rt("c")],
        ]},
    }
    out = block_to_md(block)
    # The row is a single line with 3 columns (the internal `|` is escaped).
    assert out == r"| a\|b | línia1 línia2 | c |"
    assert "\n" not in out


def test_code_block_es_literal_sense_anotacions():
    block = {
        "type": "code",
        "code": {
            "language": "python",
            "rich_text": [
                _rt("x = 1  # veure "),
                {"plain_text": "docs", "annotations": {"bold": True}, "href": "http://d"},
            ],
        },
    }
    out = block_to_md(block)
    # The code text is literal: no `**` or `[...](...)` injected.
    assert out == "```python\nx = 1  # veure docs\n```"


def test_paragraf_normal_segueix_amb_format():
    # Outside code blocks, annotations DO get applied.
    block = {"type": "paragraph", "paragraph": {"rich_text": [
        {"plain_text": "negreta", "annotations": {"bold": True}},
    ]}}
    assert block_to_md(block) == "**negreta**"
