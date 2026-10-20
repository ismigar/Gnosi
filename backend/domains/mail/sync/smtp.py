"""SMTP delivery for configured IMAP-compatible accounts."""

from __future__ import annotations

import logging
from collections.abc import Callable
from email.message import Message
from typing import Any

from backend.services.mail_inline_images import InlineImage, MimeAsset

log = logging.getLogger(__name__)


def _smtp_oauth_token(account_email: str) -> str | None:
    from backend.services.oauth2_helpers import OAuth2RefreshError, ensure_fresh_token
    from backend.domains.mail.services.submission import in_submission, transport_timeout

    try:
        access_token, _ = ensure_fresh_token(
            account_email, timeout=transport_timeout() if in_submission() else None,
        )
    except OAuth2RefreshError as error:
        log.error(f"[SMTP-XOAUTH2] {error}")
        return None
    if not access_token:
        log.error(f"[SMTP-XOAUTH2] Missing access_token for {account_email}")
    return access_token


def _close_smtp(server: Any, accepted: bool) -> None:
    from backend.domains.mail.services.submission import in_submission

    if server is None:
        return
    # Accepted DATA is the delivery result. Interactive submission closes
    # without waiting for QUIT, so cleanup cannot outlive its deadline.
    if accepted and not in_submission():
        try:
            if server.sock is not None:
                server.sock.settimeout(1.0)
            server.quit()
        except Exception:
            pass
    try:
        server.close()
    except Exception:
        pass


def _deliver_smtp(
    host: str,
    port: int,
    encryption: str,
    authenticate: Callable[[Any], None],
    sender: str,
    recipients: list[str],
    message: Message,
) -> bool:
    import copy
    import smtplib
    import ssl

    from backend.domains.mail.services.submission import (
        MailDeliveryUnknown, in_submission, transport_timeout,
    )

    server: Any = None
    accepted = False
    transmitting = False
    try:
        context = ssl.create_default_context()
        # Socket waits are bounded as well as the caller's response deadline.
        if encryption == "ssl":
            server = smtplib.SMTP_SSL(host, port, context=context, timeout=transport_timeout())
        else:
            server = smtplib.SMTP(host, port, timeout=transport_timeout())
        server.ehlo()
        if encryption == "starttls":
            server.starttls(context=context)
            server.ehlo()
        authenticate(server)
        if server.sock is not None:
            server.sock.settimeout(transport_timeout())
        # Blind recipients stay in the envelope, never the transmitted headers.
        # Preserve the caller's local message and remove every matching header.
        wire_message = copy.copy(message)
        del wire_message["Bcc"]
        del wire_message["Resent-Bcc"]
        transmitting = True
        server.sendmail(sender, recipients, wire_message.as_bytes())
        accepted = True
        return True
    except Exception as error:
        if transmitting and not accepted and not isinstance(
            error, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError),
        ) and in_submission():
            raise MailDeliveryUnknown() from error
        log.error(f"[SMTP] Error sending from {sender}: {error}")
        return False
    finally:
        _close_smtp(server, accepted)


def imap_smtp_send(
    account: dict[str, Any],
    to: str,
    subject: str,
    body: str,
    cc: str | None = None,
    bcc: str | None = None,
    attachments: list[MimeAsset] | None = None,
    from_email: str | None = None,
    from_name: str | None = None,
    inline_images: list[InlineImage] | None = None,
) -> bool:
    """Send a message via SMTP using an IMAP account's SMTP config.

    Supports two authentication modes:
    - LOGIN with password (manual/IMAP accounts).
    - SASL XOAUTH2 (Google OAuth2 accounts): refreshes the access_token if needed.

    """
    from email.utils import formataddr

    from backend.services.integration_manager import integration_manager
    from backend.services.mail_inline_images import build_mail_content

    # Resolve defaults (Google → smtp.gmail.com, etc.)
    account = integration_manager.resolve_imap_defaults(account)
    is_oauth = integration_manager.is_imap_oauth_account(account)

    account_email = str(account.get("email") or "")
    smtp_host = str(account.get("smtp_host") or "")
    smtp_port = int(account.get("smtp_port", 465))
    smtp_user = str(account.get("smtp_user") or account.get("imap_user") or account_email)
    smtp_pass = str(account.get("smtp_password") or account.get("imap_password") or "")
    smtp_enc = str(account.get("smtp_encryption") or "ssl").lower()
    sender_email = str(from_email or account_email or smtp_user)
    sender_display = str(from_name or account.get("display_name") or "")
    from_header = formataddr((sender_display, sender_email)) if sender_display else sender_email

    if not smtp_host:
        log.error("[SMTP] smtp_host no configurat")
        return False

    msg = build_mail_content(body, attachments=attachments, inline_images=inline_images)

    msg["From"] = from_header
    msg["To"] = to
    msg["Subject"] = subject
    if cc:
        msg["Cc"] = cc
    if bcc:
        msg["Bcc"] = bcc

    recipients = [a.strip() for a in to.split(",")]
    if cc:
        recipients += [a.strip() for a in cc.split(",")]
    if bcc:
        recipients += [a.strip() for a in bcc.split(",")]

    access_token = _smtp_oauth_token(account_email) if is_oauth else None
    if is_oauth and not access_token:
        return False

    def _authenticate(server: Any) -> None:
        if is_oauth:
            from backend.services.oauth2_helpers import xoauth2_smtp_login

            xoauth2_smtp_login(server, account_email, access_token or "")
        elif smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)

    success = _deliver_smtp(
        smtp_host, smtp_port, smtp_enc, _authenticate, sender_email, recipients, msg,
    )
    if success:
        log.info(f"[SMTP{'-XOAUTH2' if is_oauth else ''}] Message sent from {sender_email} to {to}")
    return success
