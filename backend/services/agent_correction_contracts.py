"""Conservative local reference checks for fully quoted proofreading requests."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
import re
import unicodedata

Feature = tuple[str, int, int]
ANCHORS: dict[str, dict[str, Feature]] = {language: {} for language in ("ca", "es", "fr", "en")}


def _group(language: str, family: str, number: int, words: str, person: int = 3) -> None:
    ANCHORS[language].update({word: (family, number, person) for word in words.split()})


for _language, _singular, _plural in [
    ("ca", "aquest aquesta", "aquests aquestes"), ("es", "este esta", "estos estas"),
    ("fr", "ce cet cette", "ces"), ("en", "this", "these"),
]:
    _group(_language, "near", 1, _singular)
    _group(_language, "near", 2, _plural)
for _language, _singular, _plural in [
    ("ca", "aquell aquella", "aquells aquelles"), ("es", "ese esa aquel aquella", "esos esas aquellos aquellas"),
    ("en", "that", "those"),
]:
    _group(_language, "far", 1, _singular)
    _group(_language, "far", 2, _plural)
for _language, _forms in {
    "ca": [(1, 1, "jo"), (2, 1, "tu vostè"), (3, 1, "ell ella"), (1, 2, "nosaltres"), (2, 2, "vosaltres"), (3, 2, "ells elles")],
    "es": [(1, 1, "yo"), (2, 1, "tú usted"), (3, 1, "él ella"), (1, 2, "nosotros nosotras"), (2, 2, "vosotros vosotras ustedes"), (3, 2, "ellos ellas")],
    "fr": [(1, 1, "je j"), (2, 1, "tu"), (3, 1, "il elle"), (1, 2, "nous"), (2, 2, "vous"), (3, 2, "ils elles")],
    "en": [(1, 1, "i"), (2, 0, "you"), (3, 1, "he she it"), (1, 2, "we"), (3, 2, "they")],
}.items():
    for _person, _number, _form_words in _forms:
        _group(_language, "person", _number, _form_words, _person)

_TRANSFORM = re.compile(r"\b(?:singular|plural|singulier|pluriel|persona|personne|person|adapta|adapte|adaptez|formal|formel|formelle|shorter|breu|breve|concise|translate|tradueix|traduce|traduire|traduisez|rewrite|reescriu|reescribe|réécris|reformula|passa|change|canvia|cambia|transforma|transforme|afirmatiu|affirmative|affirmatif|json|code|codi|código)\b", re.I)
_ACTIONS = re.compile(r"\b(?:save|send|publish|update|delete|desa|desar|guarda|guardar|envia|envía|publica|actualitza|elimina|supprime|envoyez|enregistre|enregistrez)\b", re.I)
_NEGATIVE = {"ca": {"no", "mai"}, "es": {"no", "nunca", "jamás"}, "fr": {"ne", "n", "pas", "jamais"}, "en": {"not", "no", "never"}}
_NUMBER_WORDS = {"ca": {"dos": "2", "dues": "2", "tres": "3"}, "es": {"dos": "2", "tres": "3"}, "fr": {"deux": "2", "trois": "3"}, "en": {"two": "2", "three": "3"}}


def _words(text: str) -> list[str]:
    return re.findall(r"[^\W\d_]+", unicodedata.normalize("NFC", text).casefold())


def _numbers(text: str, language: str) -> Counter[str]:
    text = re.sub(r"(?<!\w)(\d{1,2})\s*h\s*(\d{2})(?!\w)", r"\1:\2", text)
    return Counter([*re.findall(r"\d+(?:[.,]\d+)*", text), *[_NUMBER_WORDS[language][word]
                   for word in _words(text) if word in _NUMBER_WORDS[language]]])


@dataclass(frozen=True)
class CorrectionContract:
    source: str
    language: str

    def validate(self, result: str) -> str:
        if not result.strip():
            raise ValueError("agent_correction_empty_result")
        source, output = _words(self.source), _words(result)
        anchors = ANCHORS[self.language]
        def key(word: str) -> str:
            return "anchor:" + anchors[word][0] if word in anchors else word
        matcher = SequenceMatcher(a=[key(word) for word in source], b=[key(word) for word in output], autojunk=False)
        for block in matcher.get_matching_blocks():
            for offset in range(block.size):
                original, corrected = source[block.a + offset], output[block.b + offset]
                if original in anchors and corrected in anchors and anchors[original] != anchors[corrected]:
                    raise ValueError("agent_correction_reference_changed: preserve the original explicit subject's person and number")
        if source and source[0] in anchors:
            family = anchors[source[0]][0]
            def unaccented(word: str) -> str:
                return "".join(c for c in unicodedata.normalize("NFD", word) if not unicodedata.combining(c))
            if (not any(word in anchors and anchors[word][0] == family for word in output)
                    and not any(unaccented(word) == unaccented(source[0]) for word in output)):
                raise ValueError("agent_correction_reference_removed: preserve the original explicit subject")
        if _numbers(self.source, self.language) != _numbers(result, self.language):
            raise ValueError("agent_correction_quantity_changed: preserve original quantities")
        identifiers = r"\b[A-Za-z][A-Za-z0-9]*-\d+\b"
        if Counter(re.findall(identifiers, self.source)) != Counter(re.findall(identifiers, result)):
            raise ValueError("agent_correction_identifier_changed: preserve exact identifiers")
        negative = _NEGATIVE[self.language]
        if any(word in negative for word in source) and not any(word in negative for word in output):
            raise ValueError("agent_correction_negation_lost: preserve original negation")
        return result


def correction_contract(request: str) -> CorrectionContract | None:
    """Recognize a narrow instruction form; ambiguous or transforming requests opt out."""
    if len(request) > 24_000 or not re.match(r"^\s*(?:corregeix|corrigez?|correct|proofread)\b", request, re.I):
        return None
    for opening, closing in [("«", "»"), ("“", "”"), ('"', '"')]:
        start = request.find(opening)
        end = request.rfind(closing)
        if start < 0 or end <= start:
            continue
        if opening != closing and (request.count(opening) != 1 or request.count(closing) != 1):
            return None
        if opening == closing and request.count(opening) != 2:
            return None
        instruction = request[:start] + request[end + 1:]
        if not request[start + len(opening):end].strip() or _TRANSFORM.search(instruction) or _ACTIONS.search(instruction):
            return None
        lower = instruction.casefold()
        language = ("ca" if re.search(r"\b(?:català|catalan|catalán)\b", lower) else
                    "es" if re.search(r"\b(?:español|castellà|spanish|espagnol)\b", lower) else
                    "fr" if re.search(r"\b(?:français|francès|french|francés)\b", lower) else
                    "en" if re.search(r"\b(?:english|anglès|anglais|inglés)\b", lower) else
                    "ca" if lower.lstrip().startswith("corregeix") else
                    "fr" if "français" in lower or lower.lstrip().startswith("corrigez") else
                    "es" if lower.lstrip().startswith("corrige") else "en")
        return CorrectionContract(request[start + len(opening):end], language)
    return None
