"""Recognize complete chat requests that can be answered from their literal input."""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
from functools import cache
from typing import Any


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c)).replace("’", "'")


# Mark quotations before reading instructions. A field label or a passage to translate
# can itself contain punctuation, operations, or references to external sources.
_QUOTES = re.compile(
    r'''```[^`]*```|`[^`]*`|«[^«»]*»|“[^“”]*”|"(?:\\.|[^"\\])*"|'''
    r"""‘(?:’(?=\w)|[^‘’])*’|(?<!\w)'(?:'(?=\w)|\\.|[^'\\\n])*'(?!\w)"""
)
_LITERAL = r"\x00\d+\x00"
_NAME = rf"(?:{_LITERAL}|[^\W\d][\w-]*)"
_PLEASE = (r"(?:(?:please|could you(?: please)?|can you|si us plau|sisplau|(?:em )?(?:pots|podries)|"
           r"por favor|(?:me )?(?:puedes|podrias)|peux-tu|pouvez-vous|merci de)\s*,?\s+)?")
_ARTICLE = r"(?:(?:the|a|an|un|une|el|la|le|les|els|los|las)\s+|l')?"
_COMMON_LANGUAGES = frozenset("catala catalan angles english ingles anglais castella castellano spanish espanol espanyol espagnol frances french francais".split())
_LANGUAGE = r"[^\W\d_]+(?:[ -][^\W\d_]+)*?"
_TARGET = rf"(?:into |to |in |en |al |au |a (?:l'|la )?|vers (?:le |l')?)(?P<target>{_LANGUAGE})"
_FROM = rf"(?:(?:from |del |de (?:l'|la )?|du )(?P<source>{_LANGUAGE}) )?"
_TEXT = (r"(?:this|this (?:sentence|phrase|text|passage)|the following(?: sentence| phrase| text| passage)?|"
         r"(?:aquest[a]?|este|esta|ce|cette|el|la|le) (?:frase|text[oe]?|fragment|phrase|passage)"
         r"(?: (?:seguent|siguiente|suivant[e]?))?|(?:el|la) siguiente (?:texto|frase))")
_TRANSLATE = re.compile(rf"{_PLEASE}(?:translate|tradueix|traduir|traduce|traducir|traduis|traduisez|traduire)\s+")
_TRANSLATION_HEADERS = tuple(re.compile(pattern) for pattern in (
    rf"{_FROM}{_TARGET}(?: {_TEXT})?", rf"{_TEXT} {_FROM}{_TARGET}",
))
_OUTPUT_VERB = r"(?:return|reply|respond|answer|respon|retorna|devuelve|responde|contesta|r(?:é|e\u0301?)pond(?:s|ez)|retourne[z]?)"
_ONLY = r"(?:only|just|nomes|unicament|solo|solamente|unicamente|seulement|uniquement)"
_TRANSLATION_NOUN = r"(?:the |la )?(?:translation|traduccio[n]?|traduction)"
_TRANSLATION_END = re.compile(
    rf"(?:[,.;]\s*|\s+)(?:{_OUTPUT_VERB} (?:(?:{_ONLY}|with|amb|con|avec) )*{_TRANSLATION_NOUN}"
    rf"(?: {_ONLY})?|{_ONLY} {_TRANSLATION_NOUN}|{_TRANSLATION_NOUN} {_ONLY})[.!?]*$"
)
_RAW_AMBIGUOUS = re.compile(
    r"""[\x00\n;:,«»“”‘\x22`\[\]<>—&@/]|(?<!\w)'|'(?!\w)|[.!?]\s*\S|"""
    r"\b(?:and|then|also|but|while|despres|tambe|pero|mentre|y|luego|tambien|mientras|et|puis|aussi|mais)\b|(?<=\s)i\b|"
    r"\b(?:attached|previous|above|below|adjunt\w*|anterior\w*|precedent\w*|ci-dessus|"
    r"reader|lector|lecteur|vault|attachment|fichier|document|fitxer|archivo|url|"
    # An unquoted description of a passage in a named source needs retrieval.
    # Quoted passages have already been delimited and bypass this disambiguation.
    r"notes?|notas?|notebooks?|quaderns?|cahiers?|cuadernos?|pages?|pagines?|paginas?|"
    r"articles?|articulos?|repl(?:y|ies)|respostes?|respostas?|respuestas?|reponses?|"
    r"paragraphs?|paragrafs?|parrafos?|paragraphes?|sentences?|phrases?|frases?|passages?|passatges?|pasajes?|"
    r"highlight(?:ed)?|underlined|marked|ressalt\w*|subratll\w*|subray\w*|surlign\w*|souligne\w*|marcad\w*|"
    r"gmail|email|mail|inbox|correo|correu|courriel|zotero|notion|"
    r"latest|selected|derni[èe]r\w*|darrer\w*|ultim\w*|seleccion\w*)\b|"
    r"^(?:it|this|that|aixo|aquesta?|esto|eso|cela|ca)(?: (?:sentence|text[oe]?|paragraph|"
    r"passage|frase|phrase|paragraf|parrafo|paragraphe))?[.!?]*$"
)
_RAW_LITERAL = re.compile(
    r"^(?:(?:hi|hello|hola|salut|bonjour|bonsoir|bon (?:dia|vespre)|bona (?:tarda|nit)|"
    r"buenos dias|buenas (?:tardes|noches)|good (?:morning|afternoon|evening|night))[.!?]*$|"
    r"(?:i|we|they|je|nous|jo|nosaltres|yo|nosotros) [^\W\d_]+\b|(?:cal|il faut|hay que) \w+|"
    r"(?:the|el|la|le|les|els|los|las) [^\W\d_]+ "
    r"(?:is|are|was|were|has|have|will|es|son|esta[n]?|est|sont|sera[n]?) \S)"
)
_WORD = r"[^\W\d_]+"
_VERB_START = (
    r"(?!(?:of|from|about|for|in|on|with|you|we|i|that|which|who|de|del|des|du|que|qui|"
    r"con|avec|amb|sur|sobre|per|para|pour|dans|entre)\b)"
)
_SUBJECT_AND_PREDICATE = re.compile(
    rf"^(?:(?:the|a|an) (?:{_WORD} {_VERB_START}{_WORD}(?:s|ed)|{_WORD}s {_VERB_START}{_WORD})|"
    rf"(?:(?:el|els|la|les|los|las|le|un|une|una) |l'){_WORD} {_VERB_START}[^\W\d_]{{3,}}) "
    r"(?!(?:of|from|that|which|whose|de|del|du|des|que|qui)\b|d')\w"
)
_SUBJECT_SELECTOR = re.compile(
    r"^((?:the|el|els|la|les|los|las|le) )(?:first|second|third|last|next|"
    r"primer\w*|segon\w*|segund\w*|premier\w*|deuxieme|suivant\w*|"
    r"(?:mev|tev|sev|nostr|vostr)[ae]s?|(?:meu|teu|seu)s?) "
)


@cache
def _localized_languages() -> frozenset[str]:
    from babel import Locale

    # The bundled CLDR names distinguish a named target from an unresolved description.
    return frozenset(_fold(name) for locale in ("ca", "es", "fr", "en")
                     for code, name in Locale.parse(locale).languages.items()
                     if code not in {"und", "mul", "zxx", "mis"})


def _known_language(name: str) -> bool:
    if name in _COMMON_LANGUAGES:
        return True
    from backend.services.translation_helpers import normalize_lang_code

    return (len(name) > 2 and name.isalpha() and bool(normalize_lang_code(name))) or name in _localized_languages()


def _translation_header(text: str) -> bool:
    for pattern in _TRANSLATION_HEADERS:
        match = pattern.fullmatch(text)
        if match and _known_language(match["target"]) and (not match["source"] or _known_language(match["source"])):
            return True
    return False


def _translation(body: str, literals: dict[str, str]) -> bool:
    body = _TRANSLATION_END.sub("", body).strip()
    # A quoted passage has explicit boundaries, including when it precedes the target.
    quoted = re.fullmatch(rf"([^\x00]*)({_LITERAL})([^\x00]*)", body)
    if quoted:
        before, literal, after = quoted.groups()
        if not literals[literal].strip():
            return False
        if not after.strip(" .!?"):
            return _translation_header(before.rstrip(" \t\n:,-"))
        return bool(re.fullmatch(rf"(?:{_TEXT}\s*:\s*)?", before)
                    and _translation_header(after.strip().rstrip(".!?")))
    parts = re.split(r":|\n", body, maxsplit=1)
    if len(parts) != 2 or not _translation_header(parts[0].strip()):
        return False
    source = parts[1].strip()
    if _RAW_AMBIGUOUS.search(source):
        return False
    # A sentence label and an active predicate also identify supplied prose.
    # A noun phrase naming a passage still needs its source.
    return bool(_RAW_LITERAL.match(source) or (
        re.search(r"\b(?:sentence|phrase|frase)\b", parts[0])
        and _SUBJECT_AND_PREDICATE.match(_SUBJECT_SELECTOR.sub(r"\1", source))
    ))


_SAMPLE = re.compile(
    r"\b(?:(?:(?:in|for|given|with|en|dans|pour|amb|con|dada?|donne[e]?)\s+)?"
    r"(?:(?:this|the|a|an|aquest[a]?|un|una|el|la|este|esta|ce|cet|cette|un[e]?)\s+)?"
    r"(?:(?:sample|example) (?:row|record)|(?:registre|registro|fila|enregistrement|ligne) "
    r"(?:de (?:mostra|muestra|exemple|ejemplo)|d'exemple))|"
    r"(?:given|using) (?:this |the following |the |a )?(?:record|row)|given|amb|con|avec)\b"
    r"[\s,:]*(?:(?:with|where|amb|con|avec|ou)\s+)?"
)
_FIELD = r"(?:field|camp|campo|champ)"
_TYPE = r"(?:boolean[oa]?|boolea(?:na)?|booleen(?:ne)?|numeric(?:al|[oa])?|numerique)"
_NUMBER = (r"(?:[+-]?\d+(?:[.,]\d+)?|zero|cero|one|un[ao]?|une|two|dos|deux|three|tres|trois|"
           r"four|quatre|cuatro|five|cinc|cinco|cinq|six|sis|seis|seven|set|siete|sept|"
           r"eight|vuit|ocho|huit|nine|nou|nueve|neuf|ten|deu|diez|dix)")
_BINDING = re.compile(
    rf"{_ARTICLE}(?:{_FIELD}\s+)?(?P<name>{_NAME})\s*(?:[=:]|\b(?:is|equals|val|vale|es|vaut|est|"
    rf"has (?:the )?value(?: of)?|te (?:el )?valor|tiene (?:el )?valor|a pour valeur)\b)\s*"
    rf"(?P<value>{_NUMBER})(?!\w)"
)
_CALCULATE = re.compile(r"\b(?:calculate|compute|evaluate|calcula|avalua|evalua|calcule[z]?|evalue[z]?)\s+")
_FIELD_TARGET = (
    rf"{_ARTICLE}(?:{_TYPE} )?{_FIELD}(?: {_TYPE})?(?: (?:de la (?:taula|tabla)|du tableau))?"
    rf"(?: {_NAME})?\s*,?\s*"
)
_TRUE_WHEN = (
    r"(?:(?:which is|that is|que es|qui est|is|es|est) )?(?:true|cert[a]?|verdader[oa]|vrai[e]?) "
    r"(?:if|when|quan|si|cuando|quand|lorsque) "
)
_FORMULA = re.compile(
    rf"(?:{_FIELD_TARGET}(?:{_TRUE_WHEN}|(?:as|com|como|comme|whether|si|if) |[=:]\s*)|"
    rf"(?:whether |si )?)(.+)"
)
_COPULA = r"(?:(?:is|are|es|son|est|sont) )?"
_COMPARISON = (
    r"(?:>=|<=|!=|==|[=><≥≤]|\b(?:at least|at most|more than|less than|greater than|"
    r"fewer than|over|under|above|below|equal to|equals|mes (?:de|que)|menys (?:de|que)|"
    r"com a minim|com a maxim|al menos|como maximo|(?:mas|menos|mayor|menor) (?:de|que)|igual (?:a|que)|"
    r"au moins|au plus|(?:plus|moins) de|(?:superieur[e]?|inferieur[e]?|egal[e]?) a|"
    r"exceeds|supera|depasse)\b)"
)
_DIVISION = r"(?:[/÷]|\b(?:divided by|divise par)\b)"
_OPERATOR = (
    rf"(?P<comparison>{_COMPARISON})|(?P<division>{_DIVISION})|[+*×-]|"
    r"\b(?:plus|minus|times|multiplied by|mes|menys|mas|menos|per|por|fois|multiplie par)\b"
)
_OUTPUT_START = re.compile(rf"(?<=[.;\s]){_OUTPUT_VERB}(?=\s+\w)", re.I)
_JSON_OUTPUT = re.compile(
    rf"{_OUTPUT_VERB} (?:(?:{_ONLY}|with|in|as|amb|en|con|avec|un|a|an) )*"
    rf"(?:(?:objecte|objeto|objet) )?json(?: object)?"
    rf"(?: (?:with|amb|con|avec) {_ARTICLE}(?:{_TYPE} )?(?:{_FIELD}|key|clau|clave|cle)"
    rf"(?: {_TYPE})?(?: (?:named|called|anomenat|llamado|nomme))? {_NAME})?[.!]?$"
)


def _table_output(message: str) -> tuple[int, str]:
    """Locate a whole output clause outside quotations, keeping original offsets."""
    # A whole quoted key acts as one name, even if it contains whitespace or directives.
    masked = _QUOTES.sub(lambda match: "x" * len(match[0]), message)
    starts = [match.start() for match in _OUTPUT_START.finditer(masked)]
    if starts:
        start = starts[-1]
        syntax = " ".join(_fold(masked[start:]).split())
        if _JSON_OUTPUT.fullmatch(syntax):
            return start, syntax
    return len(message), ""


def supplied_table_output_directive(message: str) -> str:
    """Return the original format instruction for an already classified table request."""
    start, _ = _table_output(message)
    return message[start:]


def _sample_values(bindings: str, literals: dict[str, str]) -> dict[str, str]:
    if bindings.startswith("{") and bindings.endswith("}"):
        bindings = bindings[1:-1].strip()
    values = {}
    while bindings:
        binding = _BINDING.match(bindings)
        if not binding:
            return {}
        name = literals.get(binding["name"], binding["name"]).strip()
        if not name or name in values:
            return {}
        values[name] = binding["value"]
        bindings = bindings[binding.end():].strip()
        if bindings:
            separator = re.match(r"^(?:[,;]|(?:and|i|y|et)\b)\s*(?=\S)", bindings)
            if not separator:
                return {}
            bindings = bindings[separator.end():]
    return values


def _table(text: str, literals: dict[str, str], output: str) -> bool:
    sample = _SAMPLE.match(text)
    calculate = _CALCULATE.match(text)
    core = text.rstrip(" .!?;")
    if sample:
        calculate = _CALCULATE.search(core, sample.end())
        if not calculate:
            return False
        bindings = core[sample.end():calculate.start()].rstrip(" .,:;")
        request = core[calculate.end():]
    elif calculate:
        sample = _SAMPLE.search(core, calculate.end())
        if not sample:
            return False
        bindings = core[sample.end():]
        request = core[calculate.end():sample.start()].rstrip(" .,:;")
    else:
        return False
    values = _sample_values(bindings.strip(), literals)
    formula = _FORMULA.fullmatch(request)
    if not values or not formula:
        return False
    subject = " ".join((sample[0], bindings, request[:formula.start(1)]))
    if not re.search(rf"\b(?:row|record|registre|registro|fila|ligne|enregistrement|{_FIELD})\b", subject):
        return False
    # A rule may cite only the supplied fields and numeric constants. Do not infer
    # missing inputs (or an operation) from field names such as "total" or "eligible".
    refs = {**values, **{token: values[name.strip()] for token, name in literals.items() if name.strip() in values}}
    aliases = "|".join(re.escape(ref) for ref in refs)
    field_prefix = rf"{_ARTICLE}(?:{_FIELD} )?"
    reference = rf"{field_prefix}(?:{aliases})"
    operand = rf"(?:{reference}|{_NUMBER})"
    rule = re.fullmatch(rf"(?P<left>{operand})\s*{_COPULA}(?:{_OPERATOR})\s*(?P<right>{operand})", formula[1])
    if not rule or not any(re.fullmatch(reference, rule[side]) for side in ("left", "right")):
        return False
    declared = request[:formula.start(1)] + " " + output
    if re.search(r"\b(?:bool\w*|if|whether|si|quan|when|quand|cuando)\b", declared) and not rule["comparison"]:
        return False
    if re.search(r"\bnumer\w*\b", declared) and rule["comparison"]:
        return False
    if rule["division"]:
        bound = re.fullmatch(rf"{field_prefix}({aliases})", rule["right"])
        divisor = refs[bound[1]] if bound else rule["right"]
        return not re.fullmatch(r"[+-]?0+(?:[.,]0+)?|zero|cero", divisor)
    return True


def _request_text(message: str) -> tuple[str, dict[str, str]]:
    literals: dict[str, str] = {}

    def mark(match: re.Match[str]) -> str:
        token = f"\0{len(literals)}\0"
        value = match.group()
        edge = 3 if value.startswith("```") else 1
        literals[token] = _fold(value[edge:-edge])
        return token

    return _fold(_QUOTES.sub(mark, message)).strip(), literals


def supplied_chat_operation(message: str) -> str:
    """Return an operation only when its input, rule and instruction boundaries are known."""
    if not message or "\0" in message:
        return ""
    text, literals = _request_text(message)
    if lead := _TRANSLATE.match(text):
        return "translation" if _translation(text[lead.end():], literals) else ""
    compact = " ".join(text.split())
    if not (_SAMPLE.match(compact) or _CALCULATE.match(compact)):
        return ""
    start, output = _table_output(message)
    if output:
        text, literals = _request_text(message[:start])
        compact = " ".join(text.split())
    return "tables" if _table(compact, literals, output) else ""


def current_supplied_operation(state: Mapping[str, Any], message: str) -> str:
    """Validate the ingress marker against this turn's intact human message."""
    operation = state.get("supplied_operation")
    if not operation:
        return ""
    if (not isinstance(message, str) or state.get("user_request") != message
            or state.get("turn_authorized_tool_names") or state.get("title_edit")
            or state.get("turn_context_refs")):
        return ""
    current = next((item for item in reversed(state.get("messages") or [])
                    if getattr(item, "type", "") == "human"), None)
    if current is None or current.content != message:
        return ""
    metadata = getattr(current, "additional_kwargs", {}) or {}
    if (metadata.get("gnosi_extra_context") or "gnosi_author_user_id" in metadata
            or "gnosi_notebook_revision" in metadata
            or metadata.get("gnosi_visible_content", message) != message):
        return ""
    return operation if supplied_chat_operation(message) == operation else ""
