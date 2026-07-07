"""`block_to_md` (import de Notion) ha de:
- escapar el `|` (i col·lapsar salts) a les cel·les de `table_row`, o una
  cel·la amb un `|` trenca l'estructura de la taula GFM importada;
- serialitzar els blocs `code` amb el text LITERAL (sense aplicar-hi les
  anotacions bold/enllaç/`code`, que sortien com a marques Markdown dins el
  codi).
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
    # La fila és una sola línia amb 3 columnes (el `|` intern va escapat).
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
    # El text del codi és literal: cap `**` ni `[...](...)` injectat.
    assert out == "```python\nx = 1  # veure docs\n```"


def test_paragraf_normal_segueix_amb_format():
    # Fora dels blocs de codi, les anotacions SÍ s'apliquen.
    block = {"type": "paragraph", "paragraph": {"rich_text": [
        {"plain_text": "negreta", "annotations": {"bold": True}},
    ]}}
    assert block_to_md(block) == "**negreta**"
