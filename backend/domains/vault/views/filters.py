"""Saved-view filter evaluation with frontend-compatible coercion."""

from __future__ import annotations

import re
import unicodedata
from datetime import date

from backend.domains.vault.views.runtime_types import Filter, Metadata

TRUTHY = {"true", "1", "yes", "si", "sí", "done", "checked", "completat"}
REGEX_LITERAL_RE = re.compile(r"^/([\s\S]*)/([a-z]*)$", re.IGNORECASE)
REGEX_FLAGS_RE = re.compile(r"^[imsx]*$", re.IGNORECASE)
JS_PARSEFLOAT_RE = re.compile(r"[+-]?(?:Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)")
FULL_NUMERIC_RE = re.compile(r"^[+-]?[\d.,]+(?:[eE][+-]?\d+)?$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}")
COMMA_DECIMAL_RE = re.compile(r"^-?\d+,\d+$")


def as_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value or "").strip().lower() in TRUTHY


def normalize_field_key(name: object) -> str:
    return re.sub(r"^[^\w]+", "", str(name or ""), flags=re.UNICODE).strip().lower()


def meta_value_for_field(meta: Metadata, field: str) -> object:
    if field in meta:
        return meta[field]
    normalized_field = normalize_field_key(field)
    if normalized_field:
        for key, value in meta.items():
            if normalize_field_key(key) == normalized_field:
                return value
    return None


def period_boundary(value: object, part: str) -> object:
    if isinstance(value, dict):
        start = value.get("start") or ""
        end = value.get("end") or ""
    else:
        start, _, end = str(value or "").partition("/")
    return (end or start) if part == "end" else start


def normalize_search_text(value: object) -> str:
    decomposed = unicodedata.normalize("NFD", str(value or "").lower())
    return "".join(character for character in decomposed if not unicodedata.combining(character))


def _regex_flags(flag_text: str) -> int:
    flags = re.IGNORECASE
    if "m" in flag_text:
        flags |= re.MULTILINE
    if "s" in flag_text:
        flags |= re.DOTALL
    if "x" in flag_text:
        flags |= re.VERBOSE
    return flags


def matches_text_pattern(candidate: object, pattern: object, mode: str = "contains") -> bool:
    source = normalize_search_text(candidate)
    raw_pattern = str(pattern or "")
    normalized_pattern = normalize_search_text(raw_pattern)
    if not normalized_pattern:
        return True
    literal = REGEX_LITERAL_RE.match(raw_pattern)
    if literal and REGEX_FLAGS_RE.match(literal.group(2)):
        try:
            expression = normalize_search_text(literal.group(1))
            return re.search(expression, source, _regex_flags(literal.group(2).lower())) is not None
        except re.error:
            pass
    if "%" in normalized_pattern:
        wildcard = ".*".join(re.escape(part) for part in normalized_pattern.split("%"))
        return re.fullmatch(wildcard, source, re.IGNORECASE) is not None
    return source == normalized_pattern if mode == "equals" else normalized_pattern in source


def is_structured_author(value: object) -> bool:
    return isinstance(value, dict) and any(key in value for key in ("nom", "cognom1", "cognom2"))


def text_values(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [text for item in value for text in text_values(item)]
    if is_structured_author(value):
        assert isinstance(value, dict)
        return [
            " ".join(
                str(value.get(key) or "").strip() for key in ("nom", "cognom1", "cognom2")
            ).strip()
        ]
    if isinstance(value, dict):
        return [text for item in value.values() for text in text_values(item)]
    return [str(value)]


def matches_structured_authorship(
    value: object,
    target: object,
    operator: str,
) -> bool | None:
    if not is_structured_author(target):
        return None
    assert isinstance(target, dict)
    criteria = [
        (key, target.get(key))
        for key in ("nom", "cognom1", "cognom2")
        if str(target.get(key) or "").strip()
    ]
    if not criteria:
        return True
    mode = "equals" if operator in ("equals", "not_equals") else "contains"
    authors = value if isinstance(value, list) else [value]
    positive = any(
        all(
            matches_text_pattern(
                author.get(key)
                if isinstance(author, dict) and is_structured_author(author)
                else author,
                pattern,
                mode,
            )
            for key, pattern in criteria
        )
        for author in authors
    )
    return not positive if operator in ("not_equals", "not_contains") else positive


def parse_float_js(text: str) -> float | None:
    match = JS_PARSEFLOAT_RE.match(text.lstrip())
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def parse_numeric_value(text: str) -> float | None:
    normalized = text.strip()
    if COMMA_DECIMAL_RE.match(normalized):
        return float(normalized.replace(",", "."))
    return parse_float_js(normalized)


def _text_operator(operator: str, values: list[str], targets: list[str]) -> bool | None:
    if operator == "equals":
        return any(
            matches_text_pattern(item, target, "equals") for target in targets for item in values
        )
    if operator == "not_equals":
        return all(
            not any(matches_text_pattern(item, target, "equals") for item in values)
            for target in targets
        )
    if operator == "contains":
        return any(
            matches_text_pattern(item, target, "contains") for target in targets for item in values
        )
    if operator == "not_contains":
        return all(
            not any(matches_text_pattern(item, target, "contains") for item in values)
            for target in targets
        )
    return None


def _ordered_match(value: str, target: str, operator: str) -> bool:
    greater = operator in ("greater_than", "greater_than_or_equal")
    inclusive = operator in ("greater_than_or_equal", "less_than_or_equal")
    target_is_numeric = bool(FULL_NUMERIC_RE.match(target.strip()))
    value_stripped = value.strip()
    if target_is_numeric and FULL_NUMERIC_RE.match(value_stripped):
        number = parse_numeric_value(value)
        target_number = parse_numeric_value(target)
        if number is None or target_number is None:
            return False
        if greater:
            return number >= target_number if inclusive else number > target_number
        return number <= target_number if inclusive else number < target_number
    if target_is_numeric and not ISO_DATE_RE.match(value_stripped):
        return False
    lowered = value.lower()
    target_lowered = target.lower()
    if greater:
        return lowered >= target_lowered if inclusive else lowered > target_lowered
    return lowered <= target_lowered if inclusive else lowered < target_lowered


def _comparison_result(
    operator: str,
    value: object,
    values: list[str],
    targets: list[str],
) -> bool:
    target = targets[0]
    if operator in ("equals", "not_equals") and target.lower() in ("true", "false"):
        wanted = target.lower() == "true"
        equal = as_bool(value) == wanted
        return equal if operator == "equals" else not equal
    today = date.today().isoformat()
    normalized_targets = [(today if item == "today" else item).lower() for item in targets]
    text_result = _text_operator(operator, values, normalized_targets)
    if text_result is not None:
        return text_result
    if operator in (
        "greater_than",
        "greater_than_or_equal",
        "less_than",
        "less_than_or_equal",
    ):
        return any(_ordered_match(item, normalized_targets[0], operator) for item in values)
    return True


def apply_filter(meta: Metadata, page_id: object, filter_rule: Filter) -> bool:
    """Evaluate one legacy leaf filter exactly as the frontend does."""
    field = filter_rule.get("field") if isinstance(filter_rule, dict) else None
    if not field:
        return True
    operator = str(filter_rule.get("operator") or "equals").lower()
    raw_target = page_id if filter_rule.get("value") == "this" else filter_rule.get("value")
    value = meta_value_for_field(meta or {}, str(field))
    if filter_rule.get("periodPart") or (isinstance(value, dict) and "start" in value):
        value = period_boundary(value, str(filter_rule.get("periodPart") or "start"))
    values = text_values(value)
    if operator == "is_empty":
        return not values
    if operator == "is_not_empty":
        return bool(values)
    authorship = matches_structured_authorship(value, raw_target, operator)
    if authorship is not None:
        return authorship
    targets = (
        [str(item) for item in raw_target]
        if isinstance(raw_target, list)
        else ([] if raw_target is None else [str(raw_target)])
    )
    return True if not targets else _comparison_result(operator, value, values, targets)


def is_filter_group(node: object) -> bool:
    return isinstance(node, dict) and isinstance(node.get("rules"), list)


def apply_filter_node(meta: Metadata, page_id: object, node: object) -> bool:
    """Recursively evaluate a leaf filter or nested conjunction group."""
    if node is None:
        return True
    if is_filter_group(node):
        assert isinstance(node, dict)
        rules = node.get("rules") or []
        if not isinstance(rules, list) or not rules:
            return True
        use_or = str(node.get("conjunction") or "and").lower() == "or"
        matches = (apply_filter_node(meta, page_id, child) for child in rules)
        return any(matches) if use_or else all(matches)
    return apply_filter(meta, page_id, node) if isinstance(node, dict) else True


__all__ = [
    "COMMA_DECIMAL_RE",
    "FULL_NUMERIC_RE",
    "ISO_DATE_RE",
    "JS_PARSEFLOAT_RE",
    "REGEX_FLAGS_RE",
    "REGEX_LITERAL_RE",
    "TRUTHY",
    "apply_filter",
    "apply_filter_node",
    "as_bool",
    "is_filter_group",
    "is_structured_author",
    "matches_structured_authorship",
    "matches_text_pattern",
    "meta_value_for_field",
    "normalize_field_key",
    "normalize_search_text",
    "parse_float_js",
    "parse_numeric_value",
    "period_boundary",
    "text_values",
]
