"""JSON contract validation independent of optional format-checking packages."""

from datetime import date, datetime
import math
import re
from typing import Any

from jsonschema import FormatChecker, ValidationError, validate


def validate_json_value(value: Any, schema: dict[str, Any] | bool) -> None:
    def finite(item: Any) -> None:
        if isinstance(item, float) and not math.isfinite(item):
            raise ValidationError("Structured output must contain finite numbers")
        if isinstance(item, dict):
            for child in item.values():
                finite(child)
        elif isinstance(item, list):
            for child in item:
                finite(child)
    finite(value)
    checker = FormatChecker()

    @checker.checks("date", raises=ValueError)
    def valid_date(item: Any) -> bool:
        if not isinstance(item, str):
            return True
        return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", item)) and date.fromisoformat(item) is not None

    @checker.checks("date-time", raises=ValueError)
    def valid_datetime(item: Any) -> bool:
        if not isinstance(item, str):
            return True
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})", item):
            return False
        return datetime.fromisoformat(item.replace("t", "T").replace("z", "Z")).tzinfo is not None

    validate(value, schema, format_checker=checker)
