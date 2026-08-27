"""Compatibility facade for the local environment router.

Remove this historical import path in Gnosi PR6.
"""

from backend.domains.configuration.api.environment import router

__all__ = ["router"]
