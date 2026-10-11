"""Parse literal follow-up operands and verify illustrative examples as data."""
from __future__ import annotations

import json
import re

from backend.domains.agent.title_replacements import replace_title, title_replacements

_VERB = r'(?:ara\s+)?(?:canvia|modifica|substitueix)|(?:ahora\s+)?(?:cambia|modifica|reemplaza)|(?:now\s+)?(?:change|replace)|(?:maintenant[, ]+)?(?:modifie|remplace)'
_EXAMPLE = re.compile(r'\s*\.\s*(?:p\.?\s*ex\.?|per exemple|por ejemplo|e\.?g\.?|for example|par exemple)\s*:\s*(.+)', re.I)


def canonical_title_request(pairs: list[tuple[str, str]], language: str = 'ca') -> str:
    header, connector, join = {
        'ca': ('Als títols canvia ', ' per ', ' i '),
        'es': ('En los títulos cambia ', ' por ', ' y '),
        'en': ('In the titles replace ', ' with ', ' and '),
        'fr': ('Dans les titres remplace ', ' par ', ' et '),
    }.get(language, ('Als títols canvia ', ' per ', ' i '))
    def quote(text: str) -> str:
        return json.dumps(text, ensure_ascii=False)
    return header + join.join(quote(source) + connector + quote(target) for source, target in pairs)


def followup_pairs(message: str) -> list[tuple[str, str]] | None:
    """A new replacement is complete in operands, but deliberately lacks scope."""
    text = message.strip()
    example = _EXAMPLE.search(text)
    instruction = text[:example.start()] if example else text
    match = re.fullmatch(rf'(?:{_VERB})\s+(.+?)\s*\.?', instruction, re.I)
    pairs = title_replacements('Als títols canvia ' + match[1]) if match else None
    if not pairs or example is None:
        return pairs
    # An example may demonstrate a replacement; it cannot introduce another
    # instruction, contradict the operands, or silently change their spacing.
    illustrative = example[1].strip().removesuffix('.').rstrip()
    values = re.fullmatch(r'(.{1,80}?)\s+(?:per|por|to|with|par|→)\s+(.{1,80})', illustrative, re.I)
    if not values:
        return None
    before, after = (value.strip().strip('"«»“”') for value in values.groups())
    if any(re.search(r'\b(?:i|y|and|et|no|not|pas|envia|elimina|delete|send)\b|[;\n]', value, re.I)
           for value in (before, after)):
        return None
    return pairs if before != after and replace_title(before, pairs) == after else None


def title_assent(message: str) -> bool:
    return bool(re.fullmatch(r'(?:fes-ho|fes ho|hazlo|do it|fais-le)[.!]?', message.strip(), re.I))
