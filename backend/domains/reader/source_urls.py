"""Canonicalize the explicit newsletter input alias without accepting secrets."""
from __future__ import annotations

import re


def canonical_source_url(value: str) -> tuple[str, bool]:
    """Return the original URL or a plain newsletter mailbox as ``mailto:``.

    The alias is a mailbox, not an authority URL: passwords, encoded delimiters,
    paths and query/header parameters have no meaning in this input format.
    Existing schemes (including existing mailto values) retain their semantics.
    """
    if not value.lower().startswith('newsletter://'):
        return value, False
    mailbox = value[len('newsletter://'):]
    if not re.fullmatch(r'[^@\s\x00-\x1f\x7f-\x9f:/?#%\\<>]+@[^@\s\x00-\x1f\x7f-\x9f:/?#%\\<>]+', mailbox):
        raise ValueError('Invalid newsletter mailbox alias')
    return 'mailto:' + mailbox, True
