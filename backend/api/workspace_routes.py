"""Compatibility facade for the workspace domain router.

Remove this historical import path in Gnosi PR6 after application composition
and downstream imports use the domain package directly.
"""

from backend.domains.workspace.api.routes import router

__all__ = ["router"]
