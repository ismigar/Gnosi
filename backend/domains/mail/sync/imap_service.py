"""IMAP mail sync service.

Pull sync: downloads new messages, reconciles deleted ones, updates flags.
Push sync: propagates UI actions (trash, archive, star, read) to IMAP server.

Vault metadata added per message:
  imap_uid:    IMAP UID string (stable per folder)
  imap_folder: folder name where the message lives on the server
"""

import logging

from backend.domains.mail.sync.imap_mutations import ImapMailMutationService
from backend.domains.mail.sync.imap_protocol import (
    _FLAG_TYPE_MAP as _FLAG_TYPE_MAP,
)
from backend.domains.mail.sync.imap_protocol import (
    _FOLDER_TYPE_MAP_REVERSE as _FOLDER_TYPE_MAP_REVERSE,
)
from backend.domains.mail.sync.imap_protocol import (
    _NAME_TYPE_MAP as _NAME_TYPE_MAP,
)
from backend.domains.mail.sync.imap_protocol import (
    _TYPE_FOLDER_PREFERENCE as _TYPE_FOLDER_PREFERENCE,
)
from backend.domains.mail.sync.imap_protocol import (
    _decode_str as _decode_str,
)
from backend.domains.mail.sync.imap_protocol import (
    _detect_category as _detect_category,
)
from backend.domains.mail.sync.imap_protocol import (
    _discover_folders as _discover_folders,
)
from backend.domains.mail.sync.imap_protocol import (
    _imap_name as _imap_name,
)
from backend.domains.mail.sync.smtp import imap_smtp_send as imap_smtp_send

log = logging.getLogger(__name__)


class ImapMailSyncService(ImapMailMutationService):
    """Canonical IMAP synchronization service."""

    pass


imap_sync_service = ImapMailSyncService()
