"""Compatibility facade for newsletter ingestion."""

from typing import Any

from backend.data.db import get_engine_for_path as get_engine_for_path
from backend.domains.mail.ingestion.newsletters import (
    _ENV_DELETE_AFTER_INGEST as _ENV_DELETE_AFTER_INGEST,
)
from backend.domains.mail.ingestion.newsletters import (
    _ENV_EMAIL as _ENV_EMAIL,
)
from backend.domains.mail.ingestion.newsletters import (
    _ENV_MAIL_PORT as _ENV_MAIL_PORT,
)
from backend.domains.mail.ingestion.newsletters import (
    _ENV_MAIL_SERVER as _ENV_MAIL_SERVER,
)
from backend.domains.mail.ingestion.newsletters import (
    _ENV_MAIL_SSL as _ENV_MAIL_SSL,
)
from backend.domains.mail.ingestion.newsletters import (
    _ENV_PASSWORD as _ENV_PASSWORD,
)
from backend.domains.mail.ingestion.newsletters import (
    _UNSAFE_TAGS as _UNSAFE_TAGS,
)
from backend.domains.mail.ingestion.newsletters import (
    _URL_ATTRS as _URL_ATTRS,
)
from backend.domains.mail.ingestion.newsletters import (
    _connect_pop3 as _connect_pop3,
)
from backend.domains.mail.ingestion.newsletters import (
    _decode_mime_words as _decode_mime_words,
)
from backend.domains.mail.ingestion.newsletters import (
    _extract_sender as _extract_sender,
)
from backend.domains.mail.ingestion.newsletters import (
    _get_or_create_sender_source as _get_or_create_sender_source,
)
from backend.domains.mail.ingestion.newsletters import (
    _is_safe_url as _is_safe_url,
)
from backend.domains.mail.ingestion.newsletters import (
    _load_account_config as _load_account_config,
)
from backend.domains.mail.ingestion.newsletters import (
    fetch_and_store_newsletters as _canonical_fetch_and_store_newsletters,
)
from backend.domains.mail.ingestion.newsletters import (
    get_email_body as get_email_body,
)
from backend.domains.mail.ingestion.newsletters import (
    sanitize_html as sanitize_html,
)
from backend.domains.mail.ingestion.newsletters import (
    test_connection as test_connection,
)
from backend.services.context_vars import get_active_vault_path as get_active_vault_path


def fetch_and_store_newsletters() -> Any:
    return _canonical_fetch_and_store_newsletters(
        engine_factory=get_engine_for_path,
        vault_path_factory=get_active_vault_path,
        connect_pop3=_connect_pop3,
        source_factory=_get_or_create_sender_source,
    )
