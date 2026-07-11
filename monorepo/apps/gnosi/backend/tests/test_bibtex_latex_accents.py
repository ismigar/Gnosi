r"""`_decode_latex_accents` must not corrupt word-based LaTeX commands.

The old regex `\([cvuH])\{?(\w)\}?` (OPTIONAL brace) matched commands like
`\url{…}`, `\cite{…}` or `\verbatim` and turned them into garbled accented text
(`\url` → `r̆l`, because `\u`+`r` was read as a breve). Braced accents
(`\c{c}`, `\v{S}`…) must keep working.
"""
from backend.services.references_io import _decode_latex_accents as dec


def test_accents_braced_segueixen_funcionant():
    assert dec(r"Fran\c{c}ois") == "François"
    assert dec(r"\v{S}") == "Š"
    assert dec(r"\H{o}") == "ő"
    assert dec(r"caf\'{e}") == "café"


def test_accents_simbol_sense_clau():
    assert dec(r'M\"uller') == "Müller"
    assert dec(r"Sin\'ead") == "Sinéad"
    assert dec(r"\^o") == "ô"


def test_comandes_latex_no_es_corrompen():
    # Before: '\\url{…}' → 'r̆l{…}', '\\cite{…}' → 'i̧te{…}', '\\verbatim' → 'ěrbatim'
    assert dec(r"\url{http://ex.com}") == r"\url{http://ex.com}"
    assert dec(r"\cite{key2020}") == r"\cite{key2020}"
    assert dec(r"\verbatim text") == r"\verbatim text"


def test_text_sense_accents_intacte():
    assert dec("Hola món sense LaTeX") == "Hola món sense LaTeX"
    assert dec("") == ""
