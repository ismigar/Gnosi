"""Rank grounded quotations for a sparse reading aid, independently of citations."""
from __future__ import annotations

import math
import re
import unicodedata

# Function words in the supported reading languages do not express the idea.
_STOP_WORDS = set("""about after also although another before between could every first from have
into more most other should some such than that their them then there these
they this those through under very what when where which while will with would
aixo aquesta aquest aquesta aquestos cada como dalla debe dels desde donde
entre esta estan este esto fueron hacer hasta mismo para pero porque puede
quan què quien sans selon sobre solo sont sus tanto tiene todo todos una uno
unes unos amb avui com con des dos el els en es et les los las mai mes molt
nen no non nous notre par pas per plus por que qui sein ses seu sua sur tous
une vos vous són son the and are been being but can did does for had has her
his how its not our out she too was were why you your
""".split())


def _concepts(text: str) -> set[str]:
    plain = "".join(char for char in unicodedata.normalize("NFKD", text.casefold())
                    if not unicodedata.combining(char))
    return {word[:6] for word in re.findall(r"[^\W\d_]+", plain)
            if len(word) >= 4 and word not in _STOP_WORDS}


def highlight_priority(quote: str, title: str, body: str, *, primary: bool) -> float:
    """Use the interpreted idea to prefer its short, direct original formulation.

    This is a local relevance heuristic over already interpreted evidence. It
    does not perform another semantic review or alter the source quotations.
    """
    words = quote.split()
    if not 6 <= len(words) <= 50 or len(quote) > 420:
        return 0.0
    terms = _concepts(quote)
    if len(terms) < 3:
        return 0.0
    title_terms = _concepts(title)
    body_terms = _concepts(body)
    title_match = len(terms & title_terms) / math.sqrt(max(1, len(terms) * len(title_terms)))
    body_match = len(terms & body_terms) / math.sqrt(max(1, len(terms) * len(body_terms)))
    if (title_terms or body_terms) and not (terms & (title_terms | body_terms)):
        return 0.0
    return 2 * title_match + body_match + (0.25 if primary else 0.0) + 0.1


MAX_HIGHLIGHTS_PER_PAGE = 2
MAX_HIGHLIGHT_TEXT_FRACTION = 0.15
