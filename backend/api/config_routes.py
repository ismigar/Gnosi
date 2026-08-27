"""Compatibility facade for the configuration settings router.

Remove this historical import path in Gnosi PR6.
"""

from backend.domains.configuration.api.settings import router

__all__ = ["router"]
