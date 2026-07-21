"""OAuth2 helpers shared by IMAP+XOAUTH2 and SMTP+XOAUTH2.

This module centralizes:
  - Refreshing expired access_tokens (Google).
  - Building the SASL XOAUTH2 string.
  - XOAUTH2 login on an already-connected imaplib.IMAP4(_SSL) object.
  - XOAUTH2 login on an already-connected smtplib.SMTP(_SSL) object.

Error policy:
  - If the refresh fails (`invalid_grant`), `OAuth2RefreshError` is raised with a
    message in Catalan ready to show in the UI. The upper layer decides
    whether to turn it into a 401 error so the frontend shows "reconnect".
"""
from __future__ import annotations

import base64
import logging
from typing import Optional, Tuple

log = logging.getLogger(__name__)


class OAuth2RefreshError(Exception):
    """The access_token cannot be renewed because the refresh_token isn't valid either."""
    def __init__(self, email: str, original: Exception | None = None):
        self.email = email
        self.original = original
        super().__init__(
            f"El token OAuth2 per a {email} ha caducat i no es pot renovar. "
            f"Cal re-autenticar el compte a Configuració."
        )


def _record_refresh_outcome(email: str, error: str | None) -> None:
    """Persists the last refresh attempt on the account (for the health endpoint).

    On success, it clears `last_refresh_error`. On failure, it stores the cause
    and the timestamp. It doesn't block the flow if persistence fails.
    
    """
    try:
        from backend.services.integration_manager import integration_manager
        import time
        with integration_manager._lock:  # noqa: SLF001 — direct access to update in place
            data = integration_manager._load()  # noqa: SLF001
            email_lower = email.strip().lower()
            for section in ("emails", "mail_accounts"):
                for acc in data.get(section, []):
                    addr = (acc.get("email") or acc.get("username", "")).strip().lower()
                    if addr == email_lower:
                        if error:
                            acc["last_refresh_error"] = error
                            acc["last_refresh_error_at"] = int(time.time())
                        else:
                            acc.pop("last_refresh_error", None)
                            acc.pop("last_refresh_error_at", None)
                            acc["last_refresh_success_at"] = int(time.time())
            integration_manager._save(data)  # noqa: SLF001
    except Exception:
        pass  # best-effort, we don't want this to bring down the refresh because of it


def ensure_fresh_token(email: str) -> Tuple[Optional[str], Optional[dict]]:
    """Returns `(access_token, account_dict)` for a Google account.

    - If the current access_token is valid, it's returned unchanged.
    - If it has expired, tries `Credentials.refresh()` and persists the new token.
    - If the refresh fails with `invalid_grant`, raises `OAuth2RefreshError`.

    For non-Google accounts, returns `(None, account_dict)` so the caller
    knows it must log in with a password.
    
    """
    from backend.services.integration_manager import integration_manager
    from backend.config.env_config import get_env

    account = integration_manager.get_mail_account(email)
    if not account:
        return None, None

    if not integration_manager.is_google_account(account):
        return None, account

    client_id = account.get("client_id") or get_env("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = account.get("client_secret") or get_env("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        log.error(f"[OAuth2] Falten credencials de client per {email}")
        return None, account

    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        import time

        creds = Credentials(
            token=account.get("token"),
            refresh_token=account.get("refresh_token"),
            token_uri=account.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=client_id,
            client_secret=client_secret,
        )

        # Decides whether a refresh is needed:
        #   - `creds.expired` is only true if we have `expiry` (we don't persist it).
        #   - So we rely on `last_refresh_success_at`: if the token is
        #     more than 50 min old (Google issues them for 1h), we force a refresh.
        #   - If we've never recorded a successful refresh (legacy account), we force it.
        TOKEN_LIFETIME_S = 3600        # access_tokens duren 1h
        REFRESH_MARGIN_S = 600         # refresh 10 min before expiring
        last_ok = account.get("last_refresh_success_at") or 0
        age = time.time() - last_ok if last_ok else float("inf")
        needs_refresh = age >= (TOKEN_LIFETIME_S - REFRESH_MARGIN_S)

        if (creds.expired or needs_refresh) and creds.refresh_token:
            try:
                creds.refresh(Request())
                integration_manager.update_mail_account_token(email, creds.token)
                log.info(f"[OAuth2] Token renovat per {email}")
                # We re-read to have fresh state.
                account = integration_manager.get_mail_account(email) or account
                _record_refresh_outcome(email, error=None)
            except Exception as e:
                err_str = str(e)
                _record_refresh_outcome(email, error=err_str)
                if "invalid_grant" in err_str or "Token has been expired" in err_str:
                    raise OAuth2RefreshError(email, e) from e
                log.error(f"[OAuth2] Refresc fallit per {email}: {e}")
                raise

        return creds.token, account
    except OAuth2RefreshError:
        raise
    except Exception as e:
        log.error(f"[OAuth2] Error preparant credencials per {email}: {e}")
        return None, account


def build_xoauth2_string(email: str, access_token: str) -> bytes:
    """Builds the SASL XOAUTH2 string without encoding it (no base64).

    RFC format: `user={email}\\x01auth=Bearer {token}\\x01\\x01`
    Returns bytes because imaplib.authenticate expects it that way.
    
    """
    return f"user={email}\x01auth=Bearer {access_token}\x01\x01".encode()


def xoauth2_imap_login(imap, email: str, access_token: str) -> None:
    """Authenticates an already-open IMAP4 connection with XOAUTH2.

    Raises the original imaplib exception on failure — the caller can decide
    whether to retry after a forced refresh.
    
    """
    auth_string = build_xoauth2_string(email, access_token)
    imap.authenticate("XOAUTH2", lambda _challenge: auth_string)


def xoauth2_smtp_login(smtp, email: str, access_token: str) -> None:
    """Authenticates an already-open SMTP connection with XOAUTH2.

    smtplib has no native helper, so we send the AUTH command manually
    with the base64 string.
    
    """
    auth_string = build_xoauth2_string(email, access_token)
    encoded = base64.b64encode(auth_string).decode("ascii")
    code, resp = smtp.docmd("AUTH", f"XOAUTH2 {encoded}")
    if code != 235:
        # Some servers send a 334 with an intermediate challenge; we respond to it
        # with an empty line and read again.
        if code == 334:
            code, resp = smtp.docmd("")
        if code != 235:
            raise OSError(f"SMTP XOAUTH2 ha fallat ({code}): {resp!r}")
