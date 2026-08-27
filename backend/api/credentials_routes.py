"""Compatibility facade for the secure credentials router.

Remove this historical import path in Gnosi PR6.
"""

from backend.domains.configuration.api.credentials import router

__all__ = ["router"]
