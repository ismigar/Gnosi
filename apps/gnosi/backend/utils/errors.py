"""Safe error handling helpers for HTTP responses.

The previous code returned `str(e)` directly to clients, which exposed
stacktraces, internal paths, library identifiers and sometimes secret
fragments embedded in exception messages (e.g. SQL parameters, file
paths, raw API responses). That is a security and information-leak
problem.

This module centralises the conversion from a Python exception to a
generic, client-safe message. The full exception detail is logged
server-side under a short correlation id; the client only sees the
error type and that id, so support can still trace a given report.
"""
from __future__ import annotations

import secrets

from backend.config.logger_config import get_logger

log = get_logger(__name__)


def safe_error_detail(e: Exception, context: str = "") -> str:
    """Return a generic, client-safe error message and log full detail.

    Generates a short hex correlation id, logs `repr(e)` plus optional
    `context` under that id, and returns a string containing only the
    exception class name and the id. Never exposes `str(e)` or the
    stacktrace to the caller.

    Args:
        e: The exception that was caught.
        context: Optional free-form context (route name, operation,
            relevant ids) to include in the server-side log entry.

    Returns:
        A string like ``"Internal error [a1b2c3d4]: ValueError"``
        suitable for use as an HTTPException ``detail`` or in a JSON
        ``error`` field.
    """
    error_id = secrets.token_hex(4)
    type_name = type(e).__name__
    if context:
        log.exception(
            "Internal error [%s] in %s: %r", error_id, context, e
        )
    else:
        log.exception("Internal error [%s]: %r", error_id, e)
    return f"Internal error [{error_id}]: {type_name}"
