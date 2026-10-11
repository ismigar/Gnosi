"""Finite scope grammar for literal substitutions in the current view's titles."""
from __future__ import annotations

import re

# Names are title aliases only for records/rows/tasks in the current view.
# Named views, unrelated fields and extra actions must go through planning.
_GRAMMARS = (
    (r'(?:canvia|modifica|substitueix)',
     r'(?:als|en els)\s+(?:noms|títols)\s+'
     r'(?:de les\s+(?:tasques|files)|dels\s+registres)\s+'
     r'(?:de la vista(?:\s+(?:activa|actual))?|d[\x27’]aquesta vista)'),
    (r'(?:cambia|modifica|reemplaza|sustituye)',
     r'(?:en los|a los)\s+(?:nombres|títulos)\s+'
     r'(?:de las\s+(?:tareas|filas)|de los\s+registros)\s+'
     r'(?:de la vista(?:\s+(?:activa|actual))?|de esta vista)'),
    (r'(?:change|replace)',
     r'in the\s+(?:names|titles)\s+of the\s+(?:tasks|rows|records)\s+'
     r'in\s+(?:the\s+(?:(?:active|current)\s+)?view|this view)'),
    (r'(?:modifie|remplace)',
     r'dans les\s+(?:noms|titres)\s+des\s+(?:tâches|lignes|enregistrements)\s+'
     r'(?:de la vue(?:\s+(?:active|actuelle))?|de cette vue)'),
)
_PATTERNS = tuple(re.compile(pattern, re.I) for verb, scope in _GRAMMARS for pattern in (
    rf'{scope}\s*,?\s+{verb}\s+(?P<operands>.+)',
    rf'{verb}\s+{scope}\s*:?[ \t]+(?P<operands>.+)',
    rf'{verb}\s+(?P<operands>.+?)\s+{scope}',
))


def scoped_title_operands(text: str) -> str | None:
    """Consume the entire request; leave operands to the strict quoted parser."""
    text = text.strip().removesuffix('.').rstrip()
    return next((match['operands'] for pattern in _PATTERNS
                 if (match := pattern.fullmatch(text))), None)
