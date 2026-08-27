"""Compatibility facade and composition boundary for the mail domain."""

from __future__ import annotations

from typing import Any, Optional

from backend.domains.mail.cache import (
    _COUNTS_CACHE as _COUNTS_CACHE,
)
from backend.domains.mail.cache import (
    _MAIL_CACHE as _MAIL_CACHE,
)
from backend.domains.mail.cache import (
    _cache_key as _cache_key,
)
from backend.domains.mail.cache import (
    _get_cached_messages as _get_cached_messages,
)
from backend.domains.mail.cache import (
    _invalidate_mail_cache as _invalidate_mail_cache,
)
from backend.domains.mail.cache import (
    _set_cached_messages as _set_cached_messages,
)
from backend.domains.mail.composition import router as router
from backend.domains.mail.repositories.vault import (
    _MESSAGE_ID_RE as _MESSAGE_ID_RE,
)
from backend.domains.mail.repositories.vault import (
    _find_message_files as _find_message_files,
)
from backend.domains.mail.repositories.vault import (
    _load_vault_drafts as _load_vault_drafts,
)
from backend.domains.mail.repositories.vault import (
    _naive_metadata_from_text as _naive_metadata_from_text,
)
from backend.domains.mail.repositories.vault import (
    _repair_file as _repair_file,
)
from backend.domains.mail.repositories.vault import (
    _sanitize_yaml_string as _sanitize_yaml_string,
)
from backend.domains.mail.repositories.vault import (
    _validate_message_id as _validate_message_id,
)
from backend.domains.mail.repositories.vault import (
    get_mail_vault_path as get_mail_vault_path,
)
from backend.domains.mail.repositories.vault import (
    get_unix_timestamp as get_unix_timestamp,
)
from backend.domains.mail.repositories.vault import (
    get_vault_path as get_vault_path,
)
from backend.domains.mail.repositories.vault import (
    parse_frontmatter as parse_frontmatter,
)
from backend.domains.mail.routes.actions import (
    archive_msg as archive_msg,
)
from backend.domains.mail.routes.actions import (
    empty_folder as empty_folder,
)
from backend.domains.mail.routes.actions import (
    spam_msg as spam_msg,
)
from backend.domains.mail.routes.actions import (
    star_msg as star_msg,
)
from backend.domains.mail.routes.actions import (
    trash_msg as trash_msg,
)
from backend.domains.mail.routes.attachments import (
    get_attachment as get_attachment,
)
from backend.domains.mail.routes.attachments import (
    get_cid_image as get_cid_image,
)
from backend.domains.mail.routes.attachments import (
    set_account_enabled as set_account_enabled,
)
from backend.domains.mail.routes.compose import (
    batch_action as batch_action,
)
from backend.domains.mail.routes.compose import (
    delete_draft as delete_draft,
)
from backend.domains.mail.routes.compose import (
    extract_entities as extract_entities,
)
from backend.domains.mail.routes.compose import (
    generate_draft as generate_draft,
)
from backend.domains.mail.routes.compose import (
    get_folders as get_folders,
)
from backend.domains.mail.routes.compose import (
    mark_as_read as mark_as_read,
)
from backend.domains.mail.routes.compose import (
    move_message as move_message,
)
from backend.domains.mail.routes.compose import (
    reply_message as reply_message,
)
from backend.domains.mail.routes.compose import (
    save_draft as save_draft,
)
from backend.domains.mail.routes.compose import (
    send_mail as send_mail,
)
from backend.domains.mail.routes.compose import (
    snooze_message as snooze_message,
)
from backend.domains.mail.routes.compose import (
    suggest_recipients as suggest_recipients,
)
from backend.domains.mail.routes.messages import (
    get_mail_counts as get_mail_counts,
)
from backend.domains.mail.routes.messages import (
    get_message as get_message,
)
from backend.domains.mail.routes.messages import (
    get_messages as get_messages,
)
from backend.domains.mail.routes.messages import (
    get_thread as get_thread,
)
from backend.domains.mail.routes.messages import (
    mail_events as mail_events,
)
from backend.domains.mail.routes.messages import (
    sync_mail_accounts as sync_mail_accounts,
)
from backend.domains.mail.routes.messages import (
    update_message as update_message,
)
from backend.domains.mail.routes.tags import (
    _tag_to_dict as _tag_to_dict,
)
from backend.domains.mail.routes.tags import (
    create_tag as create_tag,
)
from backend.domains.mail.routes.tags import (
    delete_tag as delete_tag,
)
from backend.domains.mail.routes.tags import (
    get_message_tags as get_message_tags,
)
from backend.domains.mail.routes.tags import (
    get_tagged_messages as get_tagged_messages,
)
from backend.domains.mail.routes.tags import (
    get_tags_for_messages as get_tags_for_messages,
)
from backend.domains.mail.routes.tags import (
    list_tags as list_tags,
)
from backend.domains.mail.routes.tags import (
    set_message_tags as set_message_tags,
)
from backend.domains.mail.routes.tags import (
    update_tag as update_tag,
)
from backend.domains.mail.routes.views import (
    _view_to_dict as _view_to_dict,
)
from backend.domains.mail.routes.views import (
    create_view as create_view,
)
from backend.domains.mail.routes.views import (
    delete_view as delete_view,
)
from backend.domains.mail.routes.views import (
    list_views as list_views,
)
from backend.domains.mail.routes.views import (
    update_view as update_view,
)
from backend.domains.mail.services.accounts import (
    _is_imap_account as _is_imap_account,
)
from backend.domains.mail.services.accounts import (
    _is_microsoft_account as _is_microsoft_account,
)
from backend.domains.mail.services.accounts import (
    _resolve_gmail_id as _resolve_gmail_id,
)
from backend.domains.mail.services.attachments import (
    _collect_original_inline_parts as _collect_original_inline_parts,
)
from backend.domains.mail.services.attachments import (
    _embed_quoted_cid_images as _canonical_embed_quoted_cid_images,
)
from backend.domains.mail.services.attachments import (
    _gmail_get_attachment_bytes as _gmail_get_attachment_bytes,
)
from backend.domains.mail.services.attachments import (
    _imap_fetch_raw as _imap_fetch_raw,
)
from backend.models.mail import (
    MailMessageTagsSetSchema as MailMessageTagsSetSchema,
)
from backend.models.mail import (
    MailTagCreateSchema as MailTagCreateSchema,
)
from backend.models.mail import (
    MailTagUpdateSchema as MailTagUpdateSchema,
)
from backend.models.mail import (
    MailViewCreateSchema as MailViewCreateSchema,
)
from backend.models.mail import (
    MailViewUpdateSchema as MailViewUpdateSchema,
)


async def _embed_quoted_cid_images(
    email: str,
    body: str,
    inline_images: list[Any],
    source_message_id: Optional[str] | None = None,
    source_folder: str = "INBOX",
) -> str:
    return await _canonical_embed_quoted_cid_images(
        email,
        body,
        inline_images,
        source_message_id,
        source_folder,
        collector=_collect_original_inline_parts,
    )
