"""Redact common credentials before errors, spans or tool output are persisted."""
from __future__ import annotations

import re
from typing import Any

_PATTERNS = (
    (re.compile(r"(?i)(api[_ -]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+"), r"\1=[REDACTED]"),
    (re.compile(r"\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b"), "[REDACTED_KEY]"),
    (re.compile(r"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b"), "[REDACTED_TOKEN]"),
    (re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----.*?-----END [A-Z ]+PRIVATE KEY-----", re.DOTALL), "[REDACTED_PRIVATE_KEY]"),
)


def redact_secrets(value: Any, *, max_chars: int = 8_000) -> str:
    text = str(value or "")[:max_chars]
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text
