"""OAuth2 helpers compartits per IMAP+XOAUTH2 i SMTP+XOAUTH2.

Aquest mòdul centralitza:
  - Refresc d'access_tokens caducats (Google).
  - Construcció de la cadena SASL XOAUTH2.
  - Login XOAUTH2 a un objecte imaplib.IMAP4(_SSL) ja connectat.
  - Login XOAUTH2 a un objecte smtplib.SMTP(_SSL) ja connectat.

Política d'errors:
  - Si el refresh falla (`invalid_grant`), s'eleva `OAuth2RefreshError` amb un
    missatge en català llest per ensenyar a l'UI. La capa superior decideix
    si convertir-lo en error 401 perquè el frontend mostri "reconnecta".
"""
from __future__ import annotations

import base64
import logging
from typing import Optional, Tuple

log = logging.getLogger(__name__)


class OAuth2RefreshError(Exception):
    """L'access_token no es pot renovar perquè el refresh_token tampoc no és vàlid."""
    def __init__(self, email: str, original: Exception | None = None):
        self.email = email
        self.original = original
        super().__init__(
            f"El token OAuth2 per a {email} ha caducat i no es pot renovar. "
            f"Cal re-autenticar el compte a Configuració."
        )


def _record_refresh_outcome(email: str, error: str | None) -> None:
    """Persisteix l'últim intent de refresh al compte (per al health endpoint).

    En cas d'èxit, neteja `last_refresh_error`. En fallida, hi desa la causa
    i la timestamp. No bloqueja el flux si la persistència falla.
    """
    try:
        from backend.services.integration_manager import integration_manager
        import time
        with integration_manager._lock:  # noqa: SLF001 — accés directe per actualitzar in-place
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
        pass  # best-effort, no volem fer caure el refresh per això


def ensure_fresh_token(email: str) -> Tuple[Optional[str], Optional[dict]]:
    """Retorna `(access_token, account_dict)` per a un compte Google.

    - Si l'access_token actual és vàlid, el retorna sense canvis.
    - Si ha caducat, intenta `Credentials.refresh()` i persisteix el nou token.
    - Si el refresh falla per `invalid_grant`, eleva `OAuth2RefreshError`.

    Per a comptes no-Google retorna `(None, account_dict)` perquè el caller
    sap que ha de fer login amb password.
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

        creds = Credentials(
            token=account.get("token"),
            refresh_token=account.get("refresh_token"),
            token_uri=account.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=client_id,
            client_secret=client_secret,
        )

        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                integration_manager.update_mail_account_token(email, creds.token)
                log.info(f"[OAuth2] Token renovat per {email}")
                # Re-llegim per tenir l'estat fresc.
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
    """Construeix la cadena SASL XOAUTH2 sense codificar (sense base64).

    Format RFC: `user={email}\\x01auth=Bearer {token}\\x01\\x01`
    Retorna bytes perquè imaplib.authenticate l'espera així.
    """
    return f"user={email}\x01auth=Bearer {access_token}\x01\x01".encode()


def xoauth2_imap_login(imap, email: str, access_token: str) -> None:
    """Autentica una connexió IMAP4 ja oberta amb XOAUTH2.

    Eleva l'excepció original d'imaplib si falla — el caller pot decidir
    si reintenta després d'un refresh forçat.
    """
    auth_string = build_xoauth2_string(email, access_token)
    imap.authenticate("XOAUTH2", lambda _challenge: auth_string)


def xoauth2_smtp_login(smtp, email: str, access_token: str) -> None:
    """Autentica una connexió SMTP ja oberta amb XOAUTH2.

    smtplib no té helper natiu, així que enviem el comand AUTH manualment
    amb la cadena base64.
    """
    auth_string = build_xoauth2_string(email, access_token)
    encoded = base64.b64encode(auth_string).decode("ascii")
    code, resp = smtp.docmd("AUTH", f"XOAUTH2 {encoded}")
    if code != 235:
        # Alguns servidors envien 334 amb un challenge intermedi; el responem
        # amb una línia buida i tornem a llegir.
        if code == 334:
            code, resp = smtp.docmd("")
        if code != 235:
            raise OSError(f"SMTP XOAUTH2 ha fallat ({code}): {resp!r}")
