"""Compatibility facade for the canonical IMAP synchronization service."""

from backend.domains.mail.sync.imap_service import (
    _FLAG_TYPE_MAP as _FLAG_TYPE_MAP,
)
from backend.domains.mail.sync.imap_service import (
    _FOLDER_TYPE_MAP_REVERSE as _FOLDER_TYPE_MAP_REVERSE,
)
from backend.domains.mail.sync.imap_service import (
    _NAME_TYPE_MAP as _NAME_TYPE_MAP,
)
from backend.domains.mail.sync.imap_service import (
    _TYPE_FOLDER_PREFERENCE as _TYPE_FOLDER_PREFERENCE,
)
from backend.domains.mail.sync.imap_service import (
    ImapMailSyncService as ImapMailSyncService,
)
from backend.domains.mail.sync.imap_service import (
    _decode_str as _decode_str,
)
from backend.domains.mail.sync.imap_service import (
    _detect_category as _detect_category,
)
from backend.domains.mail.sync.imap_service import (
    _discover_folders as _discover_folders,
)
from backend.domains.mail.sync.imap_service import (
    _imap_name as _imap_name,
)
from backend.domains.mail.sync.imap_service import (
    imap_smtp_send as imap_smtp_send,
)
from backend.domains.mail.sync.imap_service import (
    imap_sync_service as imap_sync_service,
)
