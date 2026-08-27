"""Compatibility facade for the configuration settings router.

Remove this historical import path in Gnosi PR6.
"""

from backend.domains.configuration.api.settings import (
    deep_merge,
    get_config,
    router,
    update_config,
)

__all__ = ["deep_merge", "get_config", "router", "update_config"]
