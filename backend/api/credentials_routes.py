"""Compatibility facade for the secure credentials router.

Remove this historical import path in Gnosi PR6.
"""

from backend.domains.configuration.api.credentials import (
    CREDENTIAL_INFO,
    CREDENTIAL_KEYS,
    CredentialSet,
    CredentialStatus,
    delete_credential,
    get_credential_status,
    list_credentials,
    migrate_from_env,
    router,
    set_credential,
)

__all__ = [
    "CREDENTIAL_INFO",
    "CREDENTIAL_KEYS",
    "CredentialSet",
    "CredentialStatus",
    "delete_credential",
    "get_credential_status",
    "list_credentials",
    "migrate_from_env",
    "router",
    "set_credential",
]
