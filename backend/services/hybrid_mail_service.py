"""Compatibility facade for the canonical hybrid mail provider adapters."""

from backend.domains.mail.providers.hybrid import (
    _FOLDER_TO_TYPE as _FOLDER_TO_TYPE,
)
from backend.domains.mail.providers.hybrid import (
    _GMAIL_CATEGORY_QUERY as _GMAIL_CATEGORY_QUERY,
)
from backend.domains.mail.providers.hybrid import (
    _GMAIL_COUNT_LABELS as _GMAIL_COUNT_LABELS,
)
from backend.domains.mail.providers.hybrid import (
    _GMAIL_FOLDER_QUERY as _GMAIL_FOLDER_QUERY,
)
from backend.domains.mail.providers.hybrid import (
    _GMAIL_LABEL_TO_CATEGORY as _GMAIL_LABEL_TO_CATEGORY,
)
from backend.domains.mail.providers.hybrid import (
    _IMAP_LOCKS as _IMAP_LOCKS,
)
from backend.domains.mail.providers.hybrid import (
    _IMAP_META as _IMAP_META,
)
from backend.domains.mail.providers.hybrid import (
    _IMAP_POOL as _IMAP_POOL,
)
from backend.domains.mail.providers.hybrid import (
    _IMAP_TIMEOUT as _IMAP_TIMEOUT,
)
from backend.domains.mail.providers.hybrid import (
    _IMAP_TYPE_TO_KEY as _IMAP_TYPE_TO_KEY,
)
from backend.domains.mail.providers.hybrid import (
    _LAST_AUTH_ERROR as _LAST_AUTH_ERROR,
)
from backend.domains.mail.providers.hybrid import (
    _decode_mime as _decode_mime,
)
from backend.domains.mail.providers.hybrid import (
    _extract_gmail_body as _extract_gmail_body,
)
from backend.domains.mail.providers.hybrid import (
    _extract_gmail_parts as _extract_gmail_parts,
)
from backend.domains.mail.providers.hybrid import (
    _get_imap_account as _get_imap_account,
)
from backend.domains.mail.providers.hybrid import (
    _gmail_batch_metadata as _gmail_batch_metadata,
)
from backend.domains.mail.providers.hybrid import (
    _imap_connect_fresh as _imap_connect_fresh,
)
from backend.domains.mail.providers.hybrid import (
    _imap_folder_name as _imap_folder_name,
)
from backend.domains.mail.providers.hybrid import (
    _imap_pool_acquire as _imap_pool_acquire,
)
from backend.domains.mail.providers.hybrid import (
    _imap_pool_invalidate as _imap_pool_invalidate,
)
from backend.domains.mail.providers.hybrid import (
    _imap_pool_release as _imap_pool_release,
)
from backend.domains.mail.providers.hybrid import (
    _parse_gmail_meta as _parse_gmail_meta,
)
from backend.domains.mail.providers.hybrid import (
    _ts as _ts,
)
from backend.domains.mail.providers.hybrid import (
    gmail_get_counts as gmail_get_counts,
)
from backend.domains.mail.providers.hybrid import (
    gmail_get_message as gmail_get_message,
)
from backend.domains.mail.providers.hybrid import (
    gmail_list_messages as gmail_list_messages,
)
from backend.domains.mail.providers.hybrid import (
    imap_get_counts as imap_get_counts,
)
from backend.domains.mail.providers.hybrid import (
    imap_get_message as imap_get_message,
)
from backend.domains.mail.providers.hybrid import (
    imap_list_messages as imap_list_messages,
)
