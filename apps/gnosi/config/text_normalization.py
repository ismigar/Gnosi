# config/text_normalization.py
import re

SENT_PUNCT = r"[\.!?…]"  # pots ampliar si vols

# Llista de termes que voldries capitalitzar només a inici d’oració
# clau: forma base en minúscules  → valor: com vols que quedi capitalitzat
SENTENCE_CASE_TERMS = {
    "assignatura": "Assignatura",
    "solidaritat responsable": "Solidaritat responsable",
    "ètica": "Ètica",
    "metodologia": "Metodologia",
    "metodologies": "Metodologies",
    # afegeix-ne els que vulguis
}

# Correccions ortogràfiques/typos segures (no afecten majúscules)
SAFE_REPLACEMENTS = (
    ("accessability", "accessibility"),
    ("tecnología", "tecnologia"),
    ("asignatura", "assignatura"),
    ("questio", "qüestió"),
    ("violencia", "violència"),
    ("Üso", "Ús"),
    ("Üs", "Ús"),
    ("uso", "ús"),

    # ...
)

def _apply_safe_replacements(s: str) -> str:
    out = s
    for bad, good in SAFE_REPLACEMENTS:
        out = re.sub(rf"\b{re.escape(bad)}\b", good, out, flags=re.IGNORECASE)
    return out

def _sentence_case_term(term_lc: str, wanted: str) -> re.Pattern:
    """
    Construeix un patró que només fa match del terme a:
      - inici de text (^)
      - DESPRÉS d'un signe final d'oració + 1 espai ('. ', '! ', '? ', '… ')
    Ex.: (group1) captura el prefix, (group2) el terme.
    """
    # \b per assegurar límit de mot abans i després
    return re.compile(
        rf"(^|(?<={SENT_PUNCT}\s))(\b{re.escape(term_lc)}\b)",
        flags=re.IGNORECASE
    )

def normalize_text(s: str) -> str:
    if not s:
        return s

    # 1) Correccions segures (no toquen majúscules contextuals)
    s = _apply_safe_replacements(s)

    # 2) Capitalització condicionada a inici d’oració
    #    Per cada terme, només capitalitza si és a l'inici o després de '. ' / '! ' / '? ' / '… '
    for term_lc, wanted in SENTENCE_CASE_TERMS.items():
        pat = _sentence_case_term(term_lc, wanted)

        def repl(m: re.Match) -> str:
            prefix = m.group(1) or ""  # '' o el separador d'oració
            # Si ja està exactament com 'wanted', no toquem
            matched = m.group(2)
            if matched == wanted:
                return prefix + matched
            # Si el match té majúscules ja “correctes” (p.ex. tot en majúscules a un títol),
            # pots decidir respectar-ho. Aquí forcem la forma 'wanted' només en posició d'inici d’oració.
            return prefix + wanted

        s = pat.sub(repl, s)

    return s
