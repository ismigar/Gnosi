from fastapi import APIRouter, HTTPException, Body, Request
import logging
from backend.services.integration_manager import integration_manager
import imaplib
import smtplib
from email.parser import BytesParser
from email import policy
import socket
from typing import List, Any

router = APIRouter(prefix="/api/integrations", tags=["integrations"])
log = logging.getLogger(__name__)


@router.get("")
async def get_integrations():
    """Returns safe masked integration configuration for the UI."""
    try:
        return integration_manager.get_all_safe()
    except Exception as e:
        log.error(f"Error getting integrations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test-email")
async def test_email_connection(payload: dict = Body(...)):
    """Tests IMAP/SMTP connection for an email account."""
    try:
        imap_server = payload.get("imap_server")
        smtp_server = payload.get("smtp_server")
        username = payload.get("username")
        password = payload.get("password")

        if not all([imap_server, smtp_server, username, password]):
            return {"success": False, "error": "Falten credencials"}

        result = {"imap": False, "smtp": False, "error": None}

        # Test IMAP
        try:
            imap = imaplib.IMAP4_SSL(imap_server, timeout=10)
            imap.login(username, password)
            imap.logout()
            result["imap"] = True
        except Exception as e:
            result["error"] = f"IMAP: {str(e)}"

        # Test SMTP
        try:
            smtp = smtplib.SMTP_SSL(smtp_server, timeout=10)
            smtp.login(username, password)
            smtp.quit()
            result["smtp"] = True
        except Exception as e:
            result["error"] = f"SMTP: {str(e)}"

        return {"success": result["imap"] and result["smtp"], **result}
    except socket.timeout:
        return {"success": False, "error": "Timeout de connexió"}
    except Exception as e:
        log.error(f"Error testing email connection: {e}")
        return {"success": False, "error": str(e)}


@router.post("/test-contacts")
async def test_contacts_connection(payload: dict = Body(...)):
    """Tests CardDAV connection for a contacts account."""
    try:
        url = payload.get("url")
        username = payload.get("username")
        password = payload.get("password")

        if not all([url, username, password]):
            return {"success": False, "error": "Falten credencials"}

        import requests
        from requests.auth import HTTPBasicAuth

        try:
            response = requests.get(
                url,
                auth=HTTPBasicAuth(username, password),
                timeout=10,
                headers={"Depth": "0"},
            )

            if response.status_code in (200, 207):
                return {"success": True}
            else:
                return {"success": False, "error": f"Status: {response.status_code}"}
        except requests.exceptions.Timeout:
            return {"success": False, "error": "Timeout de connexió"}
        except requests.exceptions.RequestException as e:
            return {"success": False, "error": str(e)}
    except Exception as e:
        log.error(f"Error testing contacts connection: {e}")
        return {"success": False, "error": str(e)}


@router.post("/test-calendar")
async def test_calendar_connection(payload: dict = Body(...)):
    """Tests CalDAV connection for a calendar account."""
    try:
        url = payload.get("url")
        username = payload.get("username")
        password = payload.get("password")

        if not all([url, username, password]):
            return {"success": False, "error": "Falten credencials"}

        import requests
        from requests.auth import HTTPBasicAuth

        try:
            response = requests.request(
                "PROPFIND",
                url,
                auth=HTTPBasicAuth(username, password),
                timeout=10,
                headers={"Depth": "0"},
            )

            if response.status_code in (200, 207, 405):
                return {"success": True}
            else:
                response = requests.get(url, auth=HTTPBasicAuth(username, password), timeout=10)
                if response.status_code in (200, 207):
                    return {"success": True}
                return {"success": False, "error": f"Status: {response.status_code}"}
        except requests.exceptions.Timeout:
            return {"success": False, "error": "Timeout de connexió"}
        except requests.exceptions.RequestException as e:
            return {"success": False, "error": str(e)}
    except Exception as e:
        log.error(f"Error testing calendar connection: {e}")
        return {"success": False, "error": str(e)}


@router.put("/{integration_id}")
async def update_integration(integration_id: str, payload: dict = Body(...)):
    """Updates a specific integration (e.g. 'email', 'ai')"""
    try:
        integration_manager.update(integration_id, payload)
        return {"status": "success", "message": f"Integration {integration_id} updated"}
    except Exception as e:
        log.error(f"Error updating integration {integration_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/calendar_colors")
async def update_calendar_colors(payload: dict = Body(...)):
    """Saves custom colors for specific calendar sources."""
    try:
        integration_manager.update("calendar_colors", payload)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating calendar colors: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/calendar_aliases")
async def update_calendar_aliases(payload: dict = Body(...)):
    """Saves custom names/aliases for specific calendar sources."""
    try:
        integration_manager.update("calendar_aliases", payload)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating calendar aliases: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/calendar_selection")
async def update_calendar_selection(payload: Any = Body(...)):
    """Saves the list of visible/selected calendar sources."""
    try:
        data = payload
        if isinstance(payload, dict) and "selection" in payload:
            data = payload["selection"]

        integration_manager.update("calendar_selection", data)
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating calendar selection: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/default_calendar")
async def update_default_calendar(payload: dict = Body(...)):
    """Desa el calendari predeterminat per a noves cites."""
    try:
        integration_manager.update("default_calendar", payload.get("source", ""))
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating default calendar: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/default_mail")
async def update_default_mail(payload: dict = Body(...)):
    """Desa el compte de correu predeterminat."""
    try:
        integration_manager.update("default_mail", payload.get("email", ""))
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating default mail: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/default_contacts")
async def update_default_contacts(payload: dict = Body(...)):
    """Desa el compte de contactes predeterminat."""
    try:
        integration_manager.update("default_contacts", payload.get("email", ""))
        return {"status": "success"}
    except Exception as e:
        log.error(f"Error updating default contacts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk")
async def bulk_update_integrations(payload: dict = Body(...)):
    """Updates multiple integrations at once."""
    try:
        integration_manager.bulk_update(payload)
        return {"status": "success", "message": "Integrations updated in bulk"}
    except Exception as e:
        log.error(f"Error bulk updating integrations: {e}")
        raise HTTPException(status_code=500, detail=str(e))
