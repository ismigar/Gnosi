r"""`_decode_latex_accents` no ha de corrompre les comandes LaTeX de paraula.

L'antic regex `\([cvuH])\{?(\w)\}?` (clau OPCIONAL) casava comandes com
`\url{…}`, `\cite{…}` o `\verbatim` i les convertia en text accentuat brossa
(`\url` → `r̆l`, perquè `\u`+`r` es llegia com a breve). Els accents braced
(`\c{c}`, `\v{S}`…) han de seguir funcionant.
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
    # Abans: '\\url{…}' → 'r̆l{…}', '\\cite{…}' → 'i̧te{…}', '\\verbatim' → 'ěrbatim'
    assert dec(r"\url{http://ex.com}") == r"\url{http://ex.com}"
    assert dec(r"\cite{key2020}") == r"\cite{key2020}"
    assert dec(r"\verbatim text") == r"\verbatim text"


def test_text_sense_accents_intacte():
    assert dec("Hola món sense LaTeX") == "Hola món sense LaTeX"
    assert dec("") == ""
