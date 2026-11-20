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


_FILE_MESSAGES = {
    "pending": {
        "ca": "Les dades del núvol encara no estan disponibles. Torna-ho a provar d’aquí a uns segons.",
        "es": "Los datos de la nube aún no están disponibles. Vuelve a intentarlo en unos segundos.",
        "fr": "Les données du cloud ne sont pas encore disponibles. Réessayez dans quelques secondes.",
        "en": "Cloud data is not available yet. Retry shortly.",
    },
    "unavailable": {
        "ca": "Ara mateix el servei de núvol no pot llegir el fitxer.",
        "es": "El servicio en la nube no puede leer el archivo en este momento.",
        "fr": "Le service cloud ne peut pas lire le fichier pour le moment.",
        "en": "Cloud storage cannot read the file right now.",
    },
    "offline": {
        "ca": "Cal connexió amb el servei de núvol per obtenir el fitxer.",
        "es": "Se necesita conexión con el servicio en la nube para obtener el archivo.",
        "fr": "Une connexion au service de stockage est nécessaire pour obtenir le fichier.",
        "en": "Connect to cloud storage to download the file.",
    },
    "permission": {
        "ca": "Cal permís per llegir el fitxer al dispositiu o al servei de núvol.",
        "es": "Se necesita permiso para leer el archivo en el dispositivo o en el servicio en la nube.",
        "fr": "Une autorisation est nécessaire pour lire le fichier sur cet appareil ou dans le cloud.",
        "en": "Permission is needed to read the file on this device or in cloud storage.",
    },
    "no_space": {
        "ca": "Falta espai al dispositiu per descarregar el fitxer.",
        "es": "Falta espacio en el dispositivo para descargar el archivo.",
        "fr": "L’espace disponible sur cet appareil est insuffisant pour télécharger le fichier.",
        "en": "There is too little space on this device to download the file.",
    },
}


def metadata_unavailable_detail(preferred_language: str, reason: str = "pending") -> tuple[str, str]:
    """Return a localized provider failure without paths or file contents."""
    primary = preferred_language.partition(",")[0].partition(";")[0]
    language = primary.partition("-")[0].strip().lower()
    messages = _FILE_MESSAGES.get(reason, _FILE_MESSAGES["pending"])
    language = language if language in messages else "en"
    return language, messages[language]
