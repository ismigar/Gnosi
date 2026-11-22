"""Recognize complete chat requests that can be answered from their literal input."""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
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
_LANGUAGE = r"(?:catala[n]?|angles|english|ingles|anglais|castella[n]?|castellano|spanish|espanol|espagnol|frances|french|francais)"
_TARGET = rf"(?:into |to |in |en |al |au |a (?:l'|la )?|vers (?:le |l')?){_LANGUAGE}"
_FROM = rf"(?:(?:from |del |de (?:l'|la )?|du ){_LANGUAGE} )?"
_TEXT = (r"(?:this|this (?:sentence|phrase|text|passage)|the following(?: sentence| phrase| text| passage)?|"
         r"(?:aquest[a]?|este|esta|ce|cette|el|la|le) (?:frase|text[oe]?|fragment|phrase|passage)"
         r"(?: (?:seguent|siguiente|suivant[e]?))?|(?:el|la) siguiente (?:texto|frase))")
_TRANSLATE = re.compile(rf"{_PLEASE}(?:translate|tradueix|traduir|traduce|traducir|traduis|traduisez|traduire)\s+")
_TRANSLATION_HEADER = rf"(?:{_FROM}{_TARGET}(?: {_TEXT})?|{_TEXT} {_FROM}{_TARGET})"
_OUTPUT_VERB = r"(?:return|reply|respond|answer|respon|retorna|devuelve|responde|contesta|reponds|repondez|retourne[z]?)"
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
    r"gmail|email|mail|inbox|correo|correu|courriel|zotero|notion|"
    r"latest|selected|derni[èe]r\w*|darrer\w*|ultim\w*|seleccion\w*)\b|"
    r"^(?:it|this|that|aixo|aquesta?|esto|eso|cela|ca)(?: (?:sentence|text[oe]?|paragraph|"
    r"passage|frase|phrase|paragraf|parrafo|paragraphe))?[.!?]*$"
)


def _translation(body: str, literals: dict[str, str]) -> bool:
    body = _TRANSLATION_END.sub("", body).strip()
    # A quoted passage has explicit boundaries, including when it precedes the target.
    quoted = re.fullmatch(
        rf"(?:{_TRANSLATION_HEADER}\s*[:,-]?\s*({_LITERAL})|"
        rf"(?:{_TEXT}\s*:\s*)?({_LITERAL})\s+{_FROM}{_TARGET})[.!?]?", body,
    )
    if quoted:
        return bool(literals[quoted[1] or quoted[2]].strip())
    raw = re.fullmatch(rf"{_TRANSLATION_HEADER}[ \t]*(?::\s*|\n+)(.+)", body, re.S)
    return bool(raw and any(c.isalpha() for c in raw[1]) and not _RAW_AMBIGUOUS.search(raw[1].strip()))


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
_JSON_END = re.compile(
    rf"(?:[.;]\s*|\s+){_OUTPUT_VERB} (?:(?:{_ONLY}|with|in|as|amb|en|con|avec|un|a|an) )*"
    rf"(?:(?:objecte|objeto|objet) )?json(?: object)?"
    rf"(?: (?:with|amb|con|avec) {_ARTICLE}(?:{_TYPE} )?(?:{_FIELD}|key|clau|clave|cle)"
    rf"(?: {_TYPE})?(?: (?:named|called|anomenat|llamado|nomme))? {_NAME})?[.!]?$"
)


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


def _table(text: str, literals: dict[str, str]) -> bool:
    sample = _SAMPLE.match(text)
    calculate = _CALCULATE.match(text)
    output = _JSON_END.search(text)
    core = (text[:output.start()] if output else text).rstrip(" .!?")
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
    declared = request[:formula.start(1)] + (output[0] if output else "")
    if re.search(r"\b(?:bool\w*|if|whether|si|quan|when|quand|cuando)\b", declared) and not rule["comparison"]:
        return False
    if re.search(r"\bnumer\w*\b", declared) and rule["comparison"]:
        return False
    if rule["division"]:
        bound = re.fullmatch(rf"{field_prefix}({aliases})", rule["right"])
        divisor = refs[bound[1]] if bound else rule["right"]
        return not re.fullmatch(r"[+-]?0+(?:[.,]0+)?|zero|cero", divisor)
    return True


def supplied_chat_operation(message: str) -> str:
    """Return an operation only when its input, rule and instruction boundaries are known."""
    if not message or "\0" in message:
        return ""
    literals: dict[str, str] = {}

    def mark(match: re.Match[str]) -> str:
        token = f"\0{len(literals)}\0"
        value = match.group()
        edge = 3 if value.startswith("```") else 1
        literals[token] = _fold(value[edge:-edge])
        return token

    text = _fold(_QUOTES.sub(mark, message)).strip()
    if lead := _TRANSLATE.match(text):
        return "translation" if _translation(text[lead.end():], literals) else ""
    return "tables" if _table(" ".join(text.split()), literals) else ""


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
