"""Compatibility facade for the canonical IMAP IDLE service."""

from backend.domains.mail.sync.idle import (
    _IDLE_REFRESH_S as _IDLE_REFRESH_S,
)
from backend.domains.mail.sync.idle import (
    _RECONNECT_BACKOFF_S as _RECONNECT_BACKOFF_S,
)
from backend.domains.mail.sync.idle import (
    ImapIdleManager as ImapIdleManager,
)
from backend.domains.mail.sync.idle import (
    _Subscriber as _Subscriber,
)
from backend.domains.mail.sync.idle import (
    idle_manager as idle_manager,
)
