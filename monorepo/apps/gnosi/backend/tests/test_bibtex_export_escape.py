"""En exportar a BibTeX, els caràcters especials de LaTeX (`& % $ # _`) s'han
d'escapar o el fitxer no compila; i el round-trip export→import ha de
recuperar el text literal (desescapat simètric a `_strip_bibtex_value`).
"""
from backend.services.references_io import entry_to_bibtex, parse_bibtex


TITLE = "Computing C_max in $O(n)$ time with 50% less cost & F# code"


def test_export_escapa_els_especials():
    bib = entry_to_bibtex({"Citation Key": "k1", "Item Type": "journalArticle", "Title": TITLE})
    # Cap d'aquests caràcters ha d'aparèixer SENSE la barra invertida davant.
    assert r"\_" in bib and r"\$" in bib and r"\#" in bib
    assert r"\&" in bib and r"\%" in bib
    # I no hi ha cap `_`, `#` o `$` "nu" (sempre precedit de `\`).
    import re
    for ch in ("_", "#", "$"):
        assert not re.search(r"(?<!\\)" + re.escape(ch), bib.split("title = {", 1)[1]), ch


def test_round_trip_recupera_el_text_literal():
    meta = {"Citation Key": "k2", "Item Type": "journalArticle", "Title": TITLE, "Any": 2020}
    bib = entry_to_bibtex(meta)
    back = parse_bibtex(bib)
    assert back[0]["Title"] == TITLE


def test_valors_sense_especials_intactes():
    meta = {"Citation Key": "k3", "Item Type": "book", "Title": "Un títol normal"}
    bib = entry_to_bibtex(meta)
    assert "title = {Un títol normal}" in bib
    assert parse_bibtex(bib)[0]["Title"] == "Un títol normal"
