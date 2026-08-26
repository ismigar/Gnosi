# config/text_normalization.py
import re

SENT_PUNCT = r"[\.!?…]"  # pots ampliar si vols

# List of terms you'd want to capitalize only at the start of a sentence
# key: base form in lowercase  → value: how you want it capitalized
SENTENCE_CASE_TERMS = {
    "assignatura": "Assignatura",
    "solidaritat responsable": "Solidaritat responsable",
    "ètica": "Ètica",
    "metodologia": "Metodologia",
    "metodologies": "Metodologies",
    # add as many as you want
}

# Safe spelling/typo corrections (do not affect capitalization)
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
        Build a pattern that only matches the term at:
      - the start of the text (^)
      - AFTER a sentence-ending punctuation mark + 1 space ('. ', '! ', '? ', '… ')
    E.g.: (group1) captures the prefix, (group2) the term.
    
    """
    # \b to ensure a word boundary before and after
    return re.compile(
        rf"(^|(?<={SENT_PUNCT}\s))(\b{re.escape(term_lc)}\b)",
        flags=re.IGNORECASE
    )

def normalize_text(s: str) -> str:
    if not s:
        return s

    # 1) Safe corrections (do not touch contextual capitalization)
    s = _apply_safe_replacements(s)

    # 2) Capitalization conditioned on sentence start
    #    For each term, only capitalize if it's at the start or after '. ' / '! ' / '? ' / '… '
    for term_lc, wanted in SENTENCE_CASE_TERMS.items():
        pat = _sentence_case_term(term_lc, wanted)

        def repl(m: re.Match) -> str:
            prefix = m.group(1) or ""  # '' or the sentence separator
            # If it's already exactly like 'wanted', we don't touch it
            matched = m.group(2)
            if matched == wanted:
                return prefix + matched
            # If the match already has “correct” capitalization (e.g. all caps in a title),
            # you might decide to respect that. Here we force the 'wanted' form only in sentence-initial position.
            return prefix + wanted

        s = pat.sub(repl, s)

    return s
