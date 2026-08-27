"""Compatibility facade for the local environment router.

Remove this historical import path in Gnosi PR6.
"""

from backend.domains.configuration.api.environment import (
    ENV_PATH,
    get_env,
    parse_env_file,
    router,
    update_env,
    write_env_file,
)

__all__ = [
    "ENV_PATH",
    "get_env",
    "parse_env_file",
    "router",
    "update_env",
    "write_env_file",
]
