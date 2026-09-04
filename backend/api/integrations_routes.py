from fastapi import Depends, APIRouter, HTTPException, Request
import asyncio
import logging
from backend.services.integration_manager import integration_manager
from backend.domains.integrations.contracts import (
    CalendarSelectionRequest,
    DavConnectionTestRequest,
    DefaultAccountRequest,
    DefaultCalendarRequest,
    EmailConnectionTestRequest,
    IntegrationConnectionTestResponse,
    IntegrationsDocument,
    IntegrationUpdateResponse,
    IntegrationsUpdateRequest,
)
from backend.utils.errors import safe_error_detail
from backend.services.workspace_service import require_role
from backend.services.plugin_access import require_plugins
import imaplib
import smtplib
from email.parser import BytesParser
from email import policy
import socket
from typing import Any, Callable, cast

router = APIRouter(prefix="/api/integrations", tags=["integrations"])
log = logging.getLogger(__name__)


# ── Cache/pool invalidation on credential changes ────────────────────────────
# Fields that, if changed, invalidate the account's cached IMAP/SMTP connection
# affected. Also covers XOAUTH2 (token, refresh_token) so that a re-consent
# manual action from the UI should be applied without waiting for polling.
_MAIL_CRED_FIELDS = (
    "imap_host",
    "imap_port",
    "imap_user",
    "imap_password",
    "imap_encryption",
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_password",
    "smtp_encryption",
    "token",
    "refresh_token",
    "mail_transport",
)


def _snapshot_mail_credentials() -> dict[str, tuple[Any, ...]]:
    """Snapshot {email_lower → tuple of sensitive credentials} to detect
    changes before/after a write to integrations.json."""
    raw = integration_manager.get_raw("mail_accounts") + integration_manager.get_raw("emails")
    snapshot: dict[str, tuple[Any, ...]] = {}
    for acc in raw:
        if not isinstance(acc, dict):
            continue
        email = (acc.get("email") or acc.get("username") or "").strip().lower()
        if not email:
            continue
        snapshot[email] = tuple(acc.get(f, "") for f in _MAIL_CRED_FIELDS)
    return snapshot


def _diff_mail_credentials(
    before: dict[str, tuple[Any, ...]], after: dict[str, tuple[Any, ...]]
) -> set[str]:
    """Returns the emails whose credentials changed relative to the previous snapshot."""
    changed: set[str] = set()
    for email, vals in after.items():
        if before.get(email) != vals:
            changed.add(email)
    return changed


def _invalidate_imap_state(emails: set[str]) -> None:
    """Removes from the pool, clears the last auth error, and invalidates counts for each
    account, and restarts its IDLE worker so it reconnects with the new
    credentials immediately instead of waiting for the 5 min retry."""
    if not emails:
        return
    try:
        from backend.services.hybrid_mail_service import (
            _imap_pool_invalidate,
            _LAST_AUTH_ERROR,
        )
        from backend.api.mail_routes import _MAIL_CACHE, _COUNTS_CACHE
    except Exception as e:
        log.warning("[CRED-CHANGE] Could not import modules for invalidation: %s", e)
        return

    for email in emails:
        try:
            _imap_pool_invalidate(email)
            cast(dict[str, Any], _LAST_AUTH_ERROR).pop(email, None)
            _COUNTS_CACHE.pop(email)
        except Exception as e:
            log.debug(f"[CRED-CHANGE] Error invalidating cache for {email}: {e}")
    # _MAIL_CACHE indexes by (email, folder, category, ...); we do a full clear
    # since filtering by email is complex and the cost is low (short TTL).
    try:
        _MAIL_CACHE.clear()
    except Exception:
        pass

    # Restart workers only while Mail is active. Credential edits must never
    # wake a paused plugin through this shared configuration endpoint.
    try:
        from backend.services.imap_idle_service import idle_manager
        from backend.api.vault_routes import _load_plugins_state
        from backend.services import builtin_plugins

        load_plugins_state = _load_plugins_state
        mail_enabled = builtin_plugins.is_enabled(load_plugins_state(), "mail")
        for email in emails:
            try:
                idle_manager.stop_worker(email)
                if mail_enabled:
                    idle_manager.start_worker(email)
            except Exception as e:
                log.debug(f"[CRED-CHANGE] Error restarting IDLE for {email}: {e}")
    except Exception:
        pass

    log.info(
        f"[CRED-CHANGE] Invalidades IMAP cache/pool/idle per {len(emails)} comptes: {sorted(emails)}"
    )


@router.get("", response_model=IntegrationsDocument)
async def get_integrations() -> Any:
    """Returns safe masked integration configuration for the UI."""
    try:
        return await asyncio.to_thread(integration_manager.get_all_safe)
    except Exception as e:
        log.error(f"Error getting integrations: {e}")
        raise HTTPException(
            status_code=500, detail=safe_error_detail(e, context="GET /api/integrations")
        )


def _test_email_sync(
    imap_host: str,
    imap_port: int,
    imap_encryption: str,
    smtp_host: str,
    smtp_port: int,
    smtp_encryption: str,
    username: str,
    password: str,
) -> dict[str, Any]:
    result: dict[str, Any] = {"imap": False, "smtp": False, "error": None}
    # 1. IMAP Test
    try:
        import ssl

        enc = imap_encryption.lower()
        if enc == "ssl":
            imap: imaplib.IMAP4 = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=10)
        else:
            imap = imaplib.IMAP4(imap_host, imap_port, timeout=10)
            if enc == "starttls":
                imap.starttls()
        imap.login(username, password)
        imap.logout()
        result["imap"] = True
    except Exception as e:
        result["error"] = (
            f"IMAP: {safe_error_detail(e, context='POST /api/integrations/test-email IMAP')}"
        )

    # If the IMAP connection failed, no need to continue with SMTP, it already returns an error
    if not result["imap"]:
        return result

    # 2. SMTP Test
    try:
        import ssl

        ctx = ssl.create_default_context()
        enc = smtp_encryption.lower()
        if enc == "ssl":
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx, timeout=10) as server:
                server.ehlo()
                server.login(username, password)
            result["smtp"] = True
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.ehlo()
                if enc == "starttls":
                    server.starttls(context=ctx)
                    server.ehlo()
                server.login(username, password)
            result["smtp"] = True
    except Exception as e:
        result["error"] = (
            f"SMTP: {safe_error_detail(e, context='POST /api/integrations/test-email SMTP')}"
        )
    return result


@router.post(
    "/test-email",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("mail"))],
    response_model=IntegrationConnectionTestResponse,
)
async def test_email_connection(
    payload: EmailConnectionTestRequest,
) -> dict[str, object]:
    """Tests IMAP/SMTP connection for an email account."""
    try:
        imap_host = payload.imap_server or payload.imap_host
        imap_encryption = payload.imap_encryption
        imap_port_raw = payload.imap_port
        if imap_port_raw:
            imap_port = int(imap_port_raw)
        else:
            imap_port = 993 if imap_encryption.lower() == "ssl" else 143

        smtp_host = payload.smtp_server or payload.smtp_host
        smtp_encryption = payload.smtp_encryption
        smtp_port_raw = payload.smtp_port
        if smtp_port_raw:
            smtp_port = int(smtp_port_raw)
        else:
            smtp_port = 465 if smtp_encryption.lower() == "ssl" else 587

        username = payload.username
        password = payload.password

        required = (imap_host, smtp_host, username, password)
        if not all(isinstance(value, str) and value for value in required):
            return {"success": False, "error": "Missing credentials"}

        # imaplib/smtplib are blocking → run off-thread so they don't freeze the event loop.
        result = await asyncio.to_thread(
            _test_email_sync,
            cast(str, imap_host),
            imap_port,
            imap_encryption,
            cast(str, smtp_host),
            smtp_port,
            smtp_encryption,
            cast(str, username),
            cast(str, password),
        )
        return {"success": result["imap"] and result["smtp"], **result}
    except socket.timeout:
        return {"success": False, "error": "Connection timeout"}
    except Exception as e:
        log.error(f"Error testing email connection: {e}")
        return {
            "success": False,
            "error": safe_error_detail(e, context="POST /api/integrations/test-email"),
        }


def _validate_dav_url(url: str) -> None:
    """Reject the most dangerous SSRF targets for a user-supplied DAV URL.

    Blocks loopback and link-local (169.254 / cloud metadata), but ALLOWS
    private LAN ranges because self-hosted CalDAV/CardDAV servers legitimately
    live there. Raises HTTPException(400) when the target is not allowed.
    """
    import ipaddress
    import socket
    from urllib.parse import urlparse

    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid http(s) URL")
    try:
        infos = socket.getaddrinfo(
            parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)
        )
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve host")
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if (
            ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="URL not allowed")


@router.post(
    "/test-contacts",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("contacts"))],
    response_model=IntegrationConnectionTestResponse,
)
async def test_contacts_connection(
    payload: DavConnectionTestRequest,
) -> dict[str, object]:
    """Tests CardDAV connection for a contacts account."""
    try:
        url = payload.url
        username = payload.username
        password = payload.password

        required = (url, username, password)
        if not all(isinstance(value, str) and value for value in required):
            return {"success": False, "error": "Missing credentials"}
        dav_url = cast(str, url)
        dav_username = cast(str, username)
        dav_password = cast(str, password)
        _validate_dav_url(dav_url)

        import requests
        from requests.auth import HTTPBasicAuth

        try:
            # requests.get blocks the event loop for up to 10s → off-thread.
            response = await asyncio.to_thread(
                requests.get,
                dav_url,
                auth=HTTPBasicAuth(dav_username, dav_password),
                timeout=10,
                headers={"Depth": "0"},
            )

            if response.status_code in (200, 207):
                return {"success": True}
            else:
                return {"success": False, "error": f"Status: {response.status_code}"}
        except requests.exceptions.Timeout:
            return {"success": False, "error": "Connection timeout"}
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": safe_error_detail(
                    e, context="POST /api/integrations/test-contacts request"
                ),
            }
    except Exception as e:
        log.error(f"Error testing contacts connection: {e}")
        return {
            "success": False,
            "error": safe_error_detail(e, context="POST /api/integrations/test-contacts"),
        }


@router.post(
    "/test-calendar",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("calendar"))],
    response_model=IntegrationConnectionTestResponse,
)
async def test_calendar_connection(
    payload: DavConnectionTestRequest,
) -> dict[str, object]:
    """Tests CalDAV connection for a calendar account."""
    try:
        url = payload.url
        username = payload.username
        password = payload.password

        required = (url, username, password)
        if not all(isinstance(value, str) and value for value in required):
            return {"success": False, "error": "Missing credentials"}
        dav_url = cast(str, url)
        dav_username = cast(str, username)
        dav_password = cast(str, password)
        _validate_dav_url(dav_url)

        import requests
        from requests.auth import HTTPBasicAuth

        try:
            # requests.* blocks the event loop for up to 10s → off-thread.
            response = await asyncio.to_thread(
                requests.request,
                "PROPFIND",
                dav_url,
                auth=HTTPBasicAuth(dav_username, dav_password),
                timeout=10,
                headers={"Depth": "0"},
            )

            if response.status_code in (200, 207, 405):
                return {"success": True}
            else:
                response = await asyncio.to_thread(
                    requests.get,
                    dav_url,
                    auth=HTTPBasicAuth(dav_username, dav_password),
                    timeout=10,
                )
                if response.status_code in (200, 207):
                    return {"success": True}
                return {"success": False, "error": f"Status: {response.status_code}"}
        except requests.exceptions.Timeout:
            return {"success": False, "error": "Connection timeout"}
        except requests.exceptions.RequestException as e:
            return {
                "success": False,
                "error": safe_error_detail(
                    e, context="POST /api/integrations/test-calendar request"
                ),
            }
    except Exception as e:
        log.error(f"Error testing calendar connection: {e}")
        return {
            "success": False,
            "error": safe_error_detail(e, context="POST /api/integrations/test-calendar"),
        }


@router.put(
    "/{integration_id}",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def update_integration(integration_id: str, payload: IntegrationsUpdateRequest) -> Any:
    """Updates a specific integration (e.g. 'email', 'ai')"""
    try:
        before = (
            _snapshot_mail_credentials() if integration_id in ("mail_accounts", "emails") else {}
        )
        integration_manager.update(integration_id, payload.root)
        if before:
            _invalidate_imap_state(_diff_mail_credentials(before, _snapshot_mail_credentials()))
        return {"status": "success", "message": f"Integration {integration_id} updated"}
    except Exception as e:
        log.error(f"Error updating integration {integration_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context=f"PUT /api/integrations/{integration_id}"),
        )


@router.put(
    "/calendar_colors",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def update_calendar_colors(payload: IntegrationsUpdateRequest) -> Any:
    """Saves custom colors for specific calendar sources."""
    try:
        integration_manager.update("calendar_colors", payload.root)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating calendar colors: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="PUT /api/integrations/calendar_colors"),
        )


@router.put(
    "/calendar_aliases",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def update_calendar_aliases(payload: IntegrationsUpdateRequest) -> Any:
    """Saves custom names/aliases for specific calendar sources."""
    try:
        integration_manager.update("calendar_aliases", payload.root)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating calendar aliases: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="PUT /api/integrations/calendar_aliases"),
        )


@router.put(
    "/calendar_selection",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def update_calendar_selection(payload: CalendarSelectionRequest) -> Any:
    """Saves the list of visible/selected calendar sources."""
    try:
        data = payload.root
        if isinstance(data, dict) and "selection" in data:
            data = data["selection"]

        integration_manager.update("calendar_selection", data)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating calendar selection: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="PUT /api/integrations/calendar_selection"),
        )


@router.put(
    "/default_calendar",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def update_default_calendar(payload: DefaultCalendarRequest) -> Any:
    """Save the default calendar for new appointments."""
    try:
        integration_manager.update("default_calendar", payload.source)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating default calendar: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="PUT /api/integrations/default_calendar"),
        )


@router.put(
    "/default_mail",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def update_default_mail(payload: DefaultAccountRequest) -> Any:
    """Save the default mail account."""
    try:
        integration_manager.update("default_mail", payload.email)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating default mail: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="PUT /api/integrations/default_mail"),
        )


@router.put(
    "/default_contacts",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def update_default_contacts(payload: DefaultAccountRequest) -> Any:
    """Save the default contacts account."""
    try:
        integration_manager.update("default_contacts", payload.email)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating default contacts: {e}")
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, context="PUT /api/integrations/default_contacts"),
        )


@router.post(
    "/bulk",
    dependencies=[Depends(require_role("editor"))],
    response_model=IntegrationUpdateResponse,
)
async def bulk_update_integrations(payload: IntegrationsUpdateRequest) -> Any:
    """Updates multiple integrations at once."""
    try:
        before = _snapshot_mail_credentials()
        integration_manager.bulk_update(payload.root)
        _invalidate_imap_state(_diff_mail_credentials(before, _snapshot_mail_credentials()))
        return {"status": "success", "message": "Integrations updated in bulk"}
    except Exception as e:
        log.error(f"Error bulk updating integrations: {e}")
        raise HTTPException(
            status_code=500, detail=safe_error_detail(e, context="POST /api/integrations/bulk")
        )
