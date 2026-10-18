"""SMTP delivery for configured IMAP-compatible accounts."""

from __future__ import annotations

import logging
from typing import Any

from backend.services.mail_inline_images import InlineImage, MimeAsset

log = logging.getLogger(__name__)


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
    import smtplib
    import ssl
    from email.utils import formataddr

    from backend.services.integration_manager import integration_manager
    from backend.services.mail_inline_images import build_mail_content
    from backend.domains.mail.services.submission import (
        MailDeliveryUnknown, in_submission, transport_timeout,
    )

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

    access_token: str | None = None
    if is_oauth:
        from backend.services.oauth2_helpers import OAuth2RefreshError, ensure_fresh_token

        try:
            access_token, _ = ensure_fresh_token(
                account_email, timeout=transport_timeout() if in_submission() else None,
            )
        except OAuth2RefreshError as e:
            log.error(f"[SMTP-XOAUTH2] {e}")
            return False
        if not access_token:
            log.error(f"[SMTP-XOAUTH2] Missing access_token for {account_email}")
            return False

    def _authenticate(server: Any) -> None:
        if is_oauth:
            from backend.services.oauth2_helpers import xoauth2_smtp_login

            xoauth2_smtp_login(server, account_email, access_token or "")
        elif smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)

    server: Any = None
    accepted = False
    transmitting = False
    try:
        ctx = ssl.create_default_context()
        # Socket waits are bounded as well as the caller's response deadline.
        if smtp_enc == "ssl":
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx, timeout=transport_timeout())
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=transport_timeout())
        server.ehlo()
        if smtp_enc == "starttls":
            server.starttls(context=ctx)
            server.ehlo()
        _authenticate(server)
        if server.sock is not None:
            server.sock.settimeout(transport_timeout())
        transmitting = True
        server.sendmail(sender_email, recipients, msg.as_bytes())
        accepted = True
        # DATA acceptance is the delivery result. QUIT is connection cleanup;
        # a dropped QUIT response must not turn an accepted message into failure.
        # The interactive submission closes in finally without awaiting QUIT,
        # so cleanup cannot outlive its deadline after acceptance is known.
        if not in_submission():
            try:
                if server.sock is not None:
                    server.sock.settimeout(1.0)
                server.quit()
            except Exception:
                pass
        log.info(f"[SMTP{'-XOAUTH2' if is_oauth else ''}] Message sent from {sender_email} to {to}")
        return True
    except Exception as e:
        if transmitting and not accepted and not isinstance(
            e, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError),
        ) and in_submission():
            raise MailDeliveryUnknown() from e
        log.error(f"[SMTP] Error sending from {sender_email}: {e}")
        return False
    finally:
        if server is not None:
            try:
                server.close()
            except Exception:
                pass
