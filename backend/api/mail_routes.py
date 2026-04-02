from fastapi import APIRouter, HTTPException, Query, Body
import logging
import yaml
import re
import time
from datetime import datetime
from typing import List, Optional
from pathlib import Path
from email.utils import parsedate_to_datetime
from backend.services.google_mail_service import send_reply, update_thread_labels
from backend.services.vault_mail_sync_service import sync_service
from backend.config.app_config import load_params

router = APIRouter(prefix="/api/mail", tags=["mail"])
log = logging.getLogger(__name__)

# Load configuration and define Vault paths
cfg = load_params(strict_env=False)
VAULT_PATH = cfg.paths["VAULT"]
MAIL_VAULT_PATH = cfg.paths["MAIL"]

if MAIL_VAULT_PATH:
    try:
        MAIL_VAULT_PATH.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

def _sanitize_yaml_string(val: str) -> str:
    """Escape problematic characters to make a string safe for YAML.

    The sync service sometimes generates metadata values that already
    contain double quotes (for example the sender field often looks like
    ``"Name" <email@example.com>``).  ``yaml.dump`` wraps the entire value
    in quotes but does not escape inner quotes, leading to invalid YAML like
    ``sender: ""Name" <...>"`` which crashes the parser.  We keep a very
    simple heuristic here: escape every double quote with a backslash so the
    dumper produces a valid quoted string.
    """
    return val.replace('"', '\\"')


def _naive_metadata_from_text(yaml_text: str) -> dict:
    """Parse a YAML-like block using a very forgiving line-by-line strategy.

    This is only used when ``yaml.safe_load`` fails; we don't need to handle
    recursion or complex structures since the mail frontmatter is flat.
    """
    out = {}
    for line in yaml_text.splitlines():
        if ':' not in line:
            continue
        key, val = line.split(':', 1)
        cleaned = val.strip().strip('"').strip("'")
        out[key.strip()] = cleaned
    return out


def _repair_file(file_path: Path, yaml_text: str, body: str):
    """Attempt to rewrite a mailbox file with safe frontmatter.

    ``yaml_text`` is the raw text of the frontmatter (between the ``---``
    markers) and ``body`` is the remainder.  We build a metadata dict using
    ``_naive_metadata_from_text`` so we don't depend on the broken YAML, then
    sanitize and dump it back to disk.  This makes the file parseable on
    subsequent reads and prevents the same error from being logged repeatedly.
    """
    metadata = _naive_metadata_from_text(yaml_text)
    # escape every string value so the dumper won't blow up again
    for k, v in list(metadata.items()):
        if isinstance(v, str):
            metadata[k] = _sanitize_yaml_string(v)
    new_front = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
    file_path.write_text(f"---\n{new_front}---\n\n{body}\n", encoding="utf-8")
    log.info(f"Rewrote malformed mail frontmatter in {file_path}")


def parse_frontmatter(content: str, file_path: Optional[Path] = None):
    """Parses a markdown file to extract YAML frontmatter and body.

    ``file_path`` is optional and only used to provide context in logs.
    In the mail subsystem we log at DEBUG level because malformed frontmatter
    is expected occasionally when emails contain stray YAML-like content.
    """
    match = re.search(r'^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)', content, re.DOTALL)
    if not match:
        match = re.search(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
        
    if match:
        try:
            metadata = yaml.safe_load(match.group(1)) or {}
            body = match.group(2)
            return metadata, body
        except Exception as e:
            location = f" in {file_path}" if file_path else ""
            log.debug(f"Error parsing mail frontmatter{location}: {e}")
            # try to repair the file contents so future reads succeed
            if file_path:
                try:
                    _repair_file(file_path, match.group(1), match.group(2))
                    # after rewriting the file we can safely parse again and return
                    fixed = file_path.read_text(encoding="utf-8")
                    return parse_frontmatter(fixed, file_path)
                except Exception as rerr:
                    log.debug(f"Failed to repair {file_path}: {rerr}")
    
    return {}, content

def get_unix_timestamp(date_str):
    """Converts a date string to a Unix timestamp (seconds)."""
    if not date_str:
        return int(time.time())
    try:
        # Try email format (RFC 2822)
        dt = parsedate_to_datetime(str(date_str))
        return int(dt.timestamp())
    except Exception:
        try:
            # If it's a YAML datetime object
            if isinstance(date_str, datetime):
                return int(date_str.timestamp())
        except Exception:
            pass
    return int(time.time())

@router.get("/messages")
async def get_messages(
    email: str = "ismigar@gmail.com", 
    folder: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    """Lists messages directly from the Vault (Markdown)."""
    try:
        # Fast synchronization when requesting the list
        sync_service.sync_emails(email, limit=10)

        messages = []
        md_files = list(MAIL_VAULT_PATH.glob("*.md"))
        
        for file_path in md_files:
            try:
                content = file_path.read_text(encoding="utf-8")
                metadata, body = parse_frontmatter(content, file_path)
                
                # Basic filtering
                if category and metadata.get("category") != category:
                    continue
                if folder == "SENT" and metadata.get("type") != "Sent":
                    continue
                if (not folder or folder == "INBOX") and metadata.get("type") == "Sent":
                    continue
                if folder == "STARRED" and not metadata.get("is_starred"):
                    continue

                # Final categorization by metadata.type
                type_mapping = {
                    "Received": "inbox",
                    "Sent": "sent",
                    "Draft": "drafts",
                    "Spam": "spam",
                    "Deleted": "trash"
                }

                msg_id = metadata.get("id") or metadata.get("gmail_id") or file_path.stem.split('_')[0]
                date_val = metadata.get("date")
                ts = get_unix_timestamp(date_val)
                
                messages.append({
                    "id": msg_id,
                    "thread_id": metadata.get("thread_id") or msg_id,
                    "subject": metadata.get("title") or "Untitled",
                    "sender": metadata.get("sender") or "Unknown",
                    "recipient": metadata.get("recipients") or email,
                    "timestamp": ts,  # NOW IT IS AN INTEGER (Unix seconds)
                    "date": str(date_val) if date_val else "",
                    "snippet": (body[:150] if body else "No content") + "...",
                    "is_read": metadata.get("is_read", True),
                    "is_starred": metadata.get("is_starred", False),
                    "labels": "INBOX" if metadata.get("type") != "Enviat" else "SENT",
                    "category": metadata.get("category", "Main")
                })
            except Exception as e:
                log.error(f"Error reading mail file {file_path}: {e}")

        # Sort by descending timestamp
        messages.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return messages[offset:offset+limit]
    except Exception as e:
        log.error(f"Error in GET /api/mail/messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/messages/{message_id}")
async def get_message(message_id: str):
    """Gets message details from the Vault."""
    files = list(MAIL_VAULT_PATH.glob(f"{message_id}_*.md"))
    if not files:
        raise HTTPException(status_code=404, detail="Message not found in Vault")
    
    file_path = files[0]
    content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content, file_path)
    
    return {
        "id": metadata.get("id") or message_id,
        "thread_id": metadata.get("thread_id") or message_id,
        "subject": metadata.get("title") or "Untitled",
        "sender": metadata.get("sender") or "Unknown",
        "recipient": metadata.get("recipients") or "",
        "date": str(metadata.get("date")) if metadata.get("date") else "",
        "body_text": body or "No content",
        "is_starred": metadata.get("is_starred", False),
        "category": metadata.get("category", "Main")
    }

@router.patch("/messages/{message_id}")
async def update_message(message_id: str, update: dict):
    return {"status": "success"}

@router.post("/messages/{message_id}/reply")
async def reply_message(
    message_id: str, 
    email: str = Query(...), 
    payload: dict = Body(...)
):
    body = payload.get("body")
    success = send_reply(email=email, thread_id=message_id, body=body)
    if success:
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Error sending email")

@router.post("/ai/generate_draft")
async def generate_draft(payload: dict = Body(...)):
    from pipeline.ai_client import call_ai_with_fallback
    context = payload.get("context", "")
    instruction = payload.get("prompt", "Write a professional response.")
    ai_prompt = f"Context: {context}\nInstruction: {instruction}\nRespond only with the email body in English."
    content, provider = call_ai_with_fallback(ai_prompt)
    return {"draft": content, "provider": provider}
