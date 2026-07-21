import os
import imaplib
import email
import email.utils
from email.header import decode_header
from pathlib import Path
from datetime import datetime
import yaml
import re

from dotenv import load_dotenv

# Load environment and paths
import sys
# Add project root to sys.path to allow importing from backend.config
PROJECT_ROOT = Path(__file__).resolve().parents[4]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Now we can import the unified config
from backend.config.paths_config import get_paths

paths = get_paths()
VAULT_PATH = paths["VAULT"]
INBOX_PATH = VAULT_PATH / "Inbox"

# Ensure Inbox exists
INBOX_PATH.mkdir(parents=True, exist_ok=True)

def safe_filename(name: str) -> str:
    """Creates a filesystem-safe filename."""
    # Remove invalid characters
    safe = re.sub(r'[<>:"/\\|?*]', '_', name)
    # Limit length
    safe = safe[:100]
    return safe.strip()

def decode_mime_words(s: str) -> str:
    """Decodes MIME encoded words in email headers."""
    if not s:
        return ""
    decoded_words = []
    for word, encoding in decode_header(s):
        if isinstance(word, bytes):
            try:
                decoded_words.append(word.decode(encoding or "utf-8", errors="replace"))
            except LookupError:
                decoded_words.append(word.decode("utf-8", errors="replace"))
        else:
            decoded_words.append(word)
    return "".join(decoded_words)

def get_email_body(msg: email.message.Message) -> str:
    """Extracts the best text representation of the email body."""
    body_text = ""
    body_html = ""
    
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))
            
            if "attachment" in content_disposition:
                continue
                
            if content_type == "text/plain":
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        body_text += payload.decode(part.get_content_charset() or 'utf-8', errors="replace") + "\n"
                except Exception:
                    pass
            elif content_type == "text/html":
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        body_html += payload.decode(part.get_content_charset() or 'utf-8', errors="replace") + "\n"
                except Exception:
                    pass
    else:
        content_type = msg.get_content_type()
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                decoded = payload.decode(msg.get_content_charset() or 'utf-8', errors="replace")
                if content_type == "text/plain":
                    body_text = decoded
                elif content_type == "text/html":
                    body_html = decoded
        except Exception:
            pass
            
    # Prefer plain text if available and not empty, otherwise return a sanitized HTML or basic string
    if body_text.strip():
        return body_text
    elif body_html.strip():
        # A simple fallback: just strip basic tags if we only have HTML (in a robust script we'd use beautifulsoup)
        clean = re.sub(r'<[^>]+>', '', body_html)
        # unescape html entities roughly
        clean = clean.replace('&nbsp;', ' ').replace('&lt;', '<').replace('&gt;', '>')
        return clean
    else:
        return "*Sense contingut al cos del missatge*"

def fetch_inbox(limit=5):
    """Fetches the latest UNSEEN emails from the IMAP server and saves them as Markdown."""
    if not IMAP_SERVER or not IMAP_USER or not IMAP_PASS:
        print("[-] IMAP credentials not found in environment variables. Please set IMAP_SERVER, IMAP_USER, and IMAP_PASS.")
        return

    print(f"[*] Connecting to IMAP server: {IMAP_SERVER}...")
    try:
        mail = imaplib.IMAP4_SSL(IMAP_SERVER)
        mail.login(IMAP_USER, IMAP_PASS)
        mail.select("INBOX")
        print("[+] Logged in successfully.")

        # Search for all messages (or UNSEEN)
        # For testing, let's just grab the last X messages regardless of read status to ensure we get something
        # status, data = mail.search(None, 'UNSEEN')
        status, data = mail.search(None, 'ALL')
        
        if status != "OK":
            print("[-] No messages found!")
            return
            
        message_nums = data[0].split()
        if not message_nums:
            print("[-] Inbox is empty.")
            return

        # Get the latest `limit` messages
        message_nums = message_nums[-limit:]
        print(f"[*] Found {len(message_nums)} messages to process.")

        for num in message_nums:
            res, msg_data = mail.fetch(num, '(RFC822)')
            if res != "OK":
                continue
                
            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])
                    
                    subject = decode_mime_words(msg.get("Subject", "Sense Assumpte"))
                    from_header = decode_mime_words(msg.get("From", "Desconegut"))
                    to_header = decode_mime_words(msg.get("To", ""))
                    message_id = msg.get("Message-ID", f"unknown-{num.decode()}")
                    date_header = msg.get("Date")
                    
                    # Parse date
                    try:
                        parsed_date = email.utils.parsedate_to_datetime(date_header)
                        iso_date = parsed_date.isoformat()
                    except Exception:
                        iso_date = datetime.now().isoformat()
                        
                    body = get_email_body(msg)
                    
                    # Create frontmatter
                    frontmatter = {
                        "type": "mail",
                        "status": "unread",
                        "subject": subject,
                        "from": from_header,
                        "to": to_header,
                        "date": iso_date,
                        "message_id": message_id,
                        # Standard tags for Vault
                        "created_time": datetime.now().isoformat(),
                    }
                    
                    filename = safe_filename(f"{subject[:50]} - {parsed_date.strftime('%Y%m%d')}")
                    if not filename:
                        filename = f"Mail_{num.decode()}"
                    filepath = INBOX_PATH / f"{filename}.md"
                    
                    # Avoid duplicates
                    counter = 1
                    base_filename = filename
                    while filepath.exists():
                        filepath = INBOX_PATH / f"{base_filename} ({counter}).md"
                        counter += 1
                        
                    # Write markdown
                    content = f"---\n{yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False)}---\n\n"
                    content += f"# {subject}\n\n"
                    content += f"**De:** {from_header}\n"
                    content += f"**Data:** {iso_date}\n\n"
                    content += "---\n\n"
                    content += body
                    
                    filepath.write_text(content, encoding="utf-8")
                    print(f"[+] Saved mail: {filepath.name}")
                    
        mail.close()
        mail.logout()
        print("[*] IMAP sync complete.")

    except Exception as e:
        print(f"[-] Error parsing IMAP: {e}")

if __name__ == "__main__":
    fetch_inbox()
