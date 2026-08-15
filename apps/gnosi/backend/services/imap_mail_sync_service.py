"""IMAP mail sync service.

Pull sync: downloads new messages, reconciles deleted ones, updates flags.
Push sync: propagates UI actions (trash, archive, star, read) to IMAP server.

Vault metadata added per message:
  imap_uid:    IMAP UID string (stable per folder)
  imap_folder: folder name where the message lives on the server
"""
import imaplib
import email
import email.utils
import hashlib
import re
import socket
import time
import yaml
from contextlib import contextmanager
from email.header import decode_header
import logging
from pathlib import Path
from typing import Optional, Union, List, Tuple, Dict, Set
from backend.config.app_config import load_params
from backend.services.integration_manager import integration_manager
from backend.utils.safe_io import safe_write_text, sanitize_filename_component

log = logging.getLogger(__name__)

# RFC 6154 special-use flags → internal type
_FLAG_TYPE_MAP = {
    "\\sent": "Sent",
    "\\trash": "Deleted",
    "\\junk": "Spam",
    "\\drafts": "Draft",
    "\\spam": "Spam",
    "\\archive": "Archived",
}

# Folder name fallbacks
_NAME_TYPE_MAP = {
    "sent": "Sent",
    "sent messages": "Sent",
    "sent items": "Sent",
    "enviats": "Sent",
    "trash": "Deleted",
    "deleted": "Deleted",
    "deleted messages": "Deleted",
    "deleted items": "Deleted",
    "papelera": "Deleted",
    "paperera": "Deleted",
    "correu eliminat": "Deleted",
    "bin": "Deleted",
    "wastebasket": "Deleted",
    "junk": "Spam",
    "junk e-mail": "Spam",
    "spam": "Spam",
    "bulk mail": "Spam",
    "bulk": "Spam",
    "drafts": "Draft",
    "draft": "Draft",
    "esborranys": "Draft",
    "archive": "Archived",
    "archives": "Archived",
    "all mail": "Archived",
}

# Internal type → what server folder to use for MOVE operations
_TYPE_FOLDER_PREFERENCE = {
    "Deleted": ["Deleted", "Trash"],
    "Archived": ["Archive", "Archived", "All Mail"],
}


def _decode_str(val):
    import html
    if not val:
        return val
    try:
        parts = decode_header(val)
    except Exception:
        return str(val)
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            codec = enc
            if codec:
                codec = codec.strip().strip('"').strip("'").lower()
                if codec in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                    codec = "utf-8"
            else:
                codec = "utf-8"
            try:
                result.append(part.decode(codec, errors="replace"))
            except LookupError:
                result.append(part.decode("latin1", errors="replace"))
            except Exception:
                result.append(part.decode("utf-8", errors="replace"))
        else:
            result.append(part)
    return html.unescape("".join(result))


def _detect_category(msg) -> str:
    list_id = msg.get("List-ID", "") or msg.get("List-Id", "")
    list_unsub = msg.get("List-Unsubscribe", "")
    precedence = (msg.get("Precedence", "") or "").lower()
    x_ml = msg.get("X-Mailing-List", "") or msg.get("X-ML-Name", "")
    x_google_group = msg.get("X-Google-Group-ID", "")

    if x_google_group or (list_id and "googlegroups" in list_id.lower()):
        return "Forums"
    if list_id or x_ml:
        return "Forums"
    if precedence in ("bulk", "list"):
        return "Promotions"
    if list_unsub:
        return "Promotions"
    return "Main"


def _imap_name(folder_name: str) -> str:
    """Quote folder names that contain spaces for IMAP protocol."""
    return f'"{folder_name}"' if " " in folder_name else folder_name


def _discover_folders(imap) -> list[tuple[str, str]]:
    """Return list of (folder_name, internal_type). INBOX always first."""
    status, folder_list = imap.list()
    if status != "OK":
        return [("INBOX", "Received")]

    folders = []
    seen_types: set[str] = set()

    for raw in folder_list:
        line = raw.decode() if isinstance(raw, bytes) else raw
        parts = line.split('"')
        if len(parts) < 3:
            continue
        flags_part = parts[0].strip().lower()
        name = parts[-2] if parts[-1].strip() == "" else parts[-1]
        name = name.strip().strip('"')
        if not name:
            continue

        folder_type = None
        for flag, ftype in _FLAG_TYPE_MAP.items():
            if flag in flags_part:
                folder_type = ftype
                break

        if folder_type is None:
            name_lower = name.lower()
            folder_type = _NAME_TYPE_MAP.get(name_lower)
            if folder_type is None:
                # Try the base name of hierarchical folders (e.g. "INBOX.Trash" → "trash")
                basename = name_lower.rsplit(".", 1)[-1].rsplit("/", 1)[-1]
                if basename != name_lower:
                    folder_type = _NAME_TYPE_MAP.get(basename)

        if name.upper() == "INBOX":
            folder_type = "Received"

        if folder_type is None:
            continue

        if folder_type in seen_types and folder_type != "Received":
            log.debug(f"[IMAP] Skipping duplicate type {folder_type}: {name}")
            continue

        seen_types.add(folder_type)
        folders.append((name, folder_type))

    if not any(n.upper() == "INBOX" for n, _ in folders):
        folders.insert(0, ("INBOX", "Received"))

    return folders


_FOLDER_TYPE_MAP_REVERSE = {
    "INBOX": "Received",
    "SENT": "Sent",
    "DRAFTS": "Draft",
    "TRASH": "Deleted",
    "SPAM": "Spam",
    "STARRED": None,
}

class ImapMailSyncService:
    def __init__(self):
        self.config = load_params()
        raw_vault = self.config.paths.get("VAULT")
        self.vault_path = Path(raw_vault) if raw_vault else None
        self.mail_folder = self.vault_path / "Mail" if self.vault_path else None
        self._last_sync: dict[str, float] = {}  # key: "account/folder_type"
        self._sync_cooldown = 120  # seconds
        if self.mail_folder:
            try:
                self.mail_folder.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

    def _get_account_data(self, email_account: str) -> Optional[dict]:
        integrations = integration_manager.get_raw("mail_accounts")
        return next(
            (a for a in integrations if a.get("email") == email_account), None
        )

    @contextmanager
    def _connect(self, email_account: str):
        """Context manager: yields authenticated IMAP connection.

        Supports two authentication modes:
        - Password (LOGIN) for manual/conventional IMAP accounts.
        - SASL XOAUTH2 for Google OAuth2 accounts (and, in the future, Microsoft).

        The `integration_manager.resolve_imap_defaults` injects default
        hosts (imap.gmail.com for Google) if they aren't configured.
        
        """
        account_data = self._get_account_data(email_account)
        if not account_data:
            log.warning(f"[IMAP] Account not found: {email_account}")
            yield None
            return

        # Resolves the defaults (Google → imap.gmail.com, etc.) before validating.
        account_data = integration_manager.resolve_imap_defaults(account_data)
        is_oauth = integration_manager.is_imap_oauth_account(account_data)

        imap_host = account_data.get("imap_host")
        imap_port = int(account_data.get("imap_port") or 993)
        imap_user = account_data.get("imap_user") or account_data.get("imap_username") or email_account
        imap_password = account_data.get("imap_password")

        if not imap_host or not imap_user:
            log.error(f"[IMAP] Missing host or user for {email_account}")
            yield None
            return

        if not is_oauth and not imap_password:
            log.error(f"[IMAP] No password for {email_account} (non-OAuth)")
            yield None
            return

        encryption = account_data.get("imap_encryption", "ssl").lower()
        imap = None
        try:
            if encryption == "ssl":
                imap = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=30)
            else:
                imap = imaplib.IMAP4(imap_host, imap_port, timeout=30)
                if encryption == "starttls":
                    imap.starttls()

            if is_oauth:
                from backend.services.oauth2_helpers import (
                    ensure_fresh_token, xoauth2_imap_login, OAuth2RefreshError,
                )
                try:
                    access_token, _ = ensure_fresh_token(email_account)
                except OAuth2RefreshError:
                    log.error(f"[IMAP-XOAUTH2] Refresh_token expired for {email_account}")
                    yield None
                    return
                if not access_token:
                    log.error(f"[IMAP-XOAUTH2] Missing access_token for {email_account}")
                    yield None
                    return
                xoauth2_imap_login(imap, email_account, access_token)
                log.debug(f"[IMAP-XOAUTH2] Login OK per {email_account}")
            else:
                imap.login(imap_user, imap_password)
            yield imap
        except imaplib.IMAP4.error as e:
            log.error(f"[IMAP] Authentication error for {email_account} ({imap_host}:{imap_port}): {e}")
            yield None
        except (socket.gaierror, socket.timeout, ConnectionRefusedError, OSError) as e:
            log.error(f"[IMAP] Could not connect to {imap_host}:{imap_port} for {email_account}: {e}")
            yield None
        except Exception:
            log.exception(f"[IMAP] Unexpected connection error for {email_account}")
            yield None
        finally:
            if imap:
                try:
                    imap.logout()
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # PULL SYNC
    # ------------------------------------------------------------------

    def sync_account(self, email_account: str, limit: int = 50, folder_type: Optional[str] = None) -> Optional[int]:
        """Pull sync for one IMAP account.

        Returns the number of synced messages, 0 if nothing new, or None if the
        connection failed (so callers can distinguish auth errors from empty syncs).
        If folder_type is provided, only that folder is synced (fast path).
        A per-(account, folder) cooldown prevents redundant syncs.
        """
        cache_key = f"{email_account}/{folder_type or 'all'}"
        now = time.monotonic()
        if now - self._last_sync.get(cache_key, 0) < self._sync_cooldown:
            log.debug(f"[IMAP] Salt sync per cooldown: {cache_key}")
            return 0

        with self._connect(email_account) as imap:
            if imap is None:
                return None

            folders = _discover_folders(imap)
            if folder_type:
                folders = [(n, t) for n, t in folders if t == folder_type]
            else:
                log.info(
                    f"[IMAP] {email_account}: carpetes: "
                    + ", ".join(f"{n}({t})" for n, t in folders)
                )

            total_synced = 0
            for folder_name, ft in folders:
                total_synced += self._sync_folder(
                    imap, email_account, folder_name, ft, limit
                )

        self._last_sync[cache_key] = now
        return total_synced

    def _sync_folder(self, imap, email_account: str, folder_name: str, folder_type: str, limit: int) -> int:
        try:
            status, _ = imap.select(_imap_name(folder_name), readonly=True)
            if status != "OK":
                log.warning(f"[IMAP] Could not select folder: {folder_name}")
                return 0
        except Exception as e:
            log.warning(f"[IMAP] Error selecting {folder_name}: {e}")
            return 0

        # Get all UIDs on server (excludes \Deleted-flagged)
        try:
            status, uid_data = imap.uid("search", None, "NOT DELETED")
            if status != "OK":
                return 0
            server_uids = set(uid_data[0].split())
            log.info(f"[IMAP] {email_account}/{folder_name} ({folder_type}): {len(server_uids)} messages on server")
        except Exception as e:
            log.error(f"[IMAP] Search failed for {folder_name}: {e}")
            return 0

        # --- Reconcile: remove vault files no longer on server ---
        # Guard against destroying the local mirror on an empty/spurious search:
        # `b''.split()` yields an empty set (empty folder, or a transient OK-empty
        # response some servers return), and reconcile would then unlink() every
        # local message for this folder. Only reconcile when the server actually
        # reported messages.
        if server_uids:
            self._reconcile_folder(email_account, folder_name, server_uids)
        else:
            log.info(
                f"[IMAP] {email_account}/{folder_name}: empty server search; "
                "skipping reconcile to avoid deleting the local mirror"
            )

        # --- Download new messages ---
        vault_uids = self._get_vault_uids(email_account, folder_name)
        new_uids = [uid for uid in server_uids if uid not in vault_uids]
        # Sort numerically, take most recent (highest UIDs)
        try:
            new_uids.sort(key=lambda x: int(x), reverse=True)
        except ValueError:
            pass
        to_download = new_uids[:limit]

        count = 0
        for uid in reversed(to_download):
            if self._sync_single_uid(imap, uid, email_account, folder_name, folder_type):
                count += 1

        if count:
            log.info(f"[IMAP]   Downloaded {count} new messages from {folder_name}")

        # --- Sync flags for recent messages already in vault ---
        recent_uids = sorted(server_uids, key=lambda x: int(x) if x.isdigit() else 0, reverse=True)[:limit]
        self._sync_flags(imap, email_account, folder_name, recent_uids)

        return count

    def _reconcile_folder(self, email_account: str, folder_name: str, server_uids: set):
        """Remove vault files whose imap_uid is no longer present on server.

        Note: this iterates filesystem operations, not DB rows. There is no
        SQL transaction to wrap. If the process crashes mid-loop, the next
        sync will reconcile any leftover files (idempotent by design).
        """
        if not self.mail_folder:
            return

        # Normalise server_uids to a set of strings so comparison is unambiguous.
        # imap.uid("search") returns bytes, but downstream code may pass strings.
        normalized_server_uids: set = set()
        for sid in server_uids:
            if isinstance(sid, bytes):
                try:
                    normalized_server_uids.add(sid.decode())
                except Exception:
                    continue
            else:
                normalized_server_uids.add(str(sid))

        removed = 0
        for file_path in list(self.mail_folder.glob("*.md")):
            try:
                content = file_path.read_text(encoding="utf-8")
                meta = self._parse_meta(content)
                if meta.get("account") != email_account:
                    continue
                if meta.get("imap_folder") != folder_name:
                    continue
                uid = meta.get("imap_uid")
                if uid and str(uid) not in normalized_server_uids:
                    file_path.unlink(missing_ok=True)
                    html = file_path.with_suffix(".html")
                    if html.exists():
                        html.unlink(missing_ok=True)
                    removed += 1
                    log.info(f"[IMAP] Reconciled (deleted from server): {file_path.name}")
            except Exception as e:
                log.debug(f"[IMAP] Error reconciling {file_path.name}: {e}")
        if removed:
            log.info(f"[IMAP] Reconciliation for {folder_name}: {removed} files deleted from the Vault")

    def _get_vault_uids(self, email_account: str, folder_name: str) -> set:
        """Return set of imap_uid strings already in vault for this account+folder."""
        if not self.mail_folder:
            return set()
        uids = set()
        for file_path in self.mail_folder.glob("*.md"):
            try:
                content = file_path.read_text(encoding="utf-8")
                meta = self._parse_meta(content)
                if meta.get("account") == email_account and meta.get("imap_folder") == folder_name:
                    uid = meta.get("imap_uid")
                    if uid:
                        uids.add(str(uid).encode())
            except Exception:
                pass
        return uids

    def _sync_flags(self, imap, email_account: str, folder_name: str, uids: list):
        """Update \Seen and \Flagged flags in vault for recently active messages."""
        if not uids:
            return
        uid_str = b",".join(uids)
        try:
            status, flag_data = imap.uid("fetch", uid_str, "(FLAGS)")
            if status != "OK":
                return
        except Exception:
            return

        uid_flags: dict[str, tuple[bool, bool]] = {}
        for item in flag_data:
            if not isinstance(item, bytes):
                continue
            s = item.decode()
            import re
            m = re.search(r"UID (\d+)", s)
            if not m:
                continue
            uid = m.group(1)
            is_seen = "\\Seen" in s
            is_flagged = "\\Flagged" in s
            uid_flags[uid] = (is_seen, is_flagged)

        if not uid_flags:
            return

        for file_path in self.mail_folder.glob("*.md"):
            try:
                content = file_path.read_text(encoding="utf-8")
                meta = self._parse_meta(content)
                if meta.get("account") != email_account or meta.get("imap_folder") != folder_name:
                    continue
                uid = str(meta.get("imap_uid", ""))
                if uid not in uid_flags:
                    continue
                is_seen, is_flagged = uid_flags[uid]
                changed = False
                if meta.get("is_read") != is_seen:
                    meta["is_read"] = is_seen
                    changed = True
                if meta.get("is_starred") != is_flagged:
                    meta["is_starred"] = is_flagged
                    changed = True
                if changed:
                    body = content.split("---\n", 2)[-1] if "---" in content else content
                    new_front = yaml.dump(meta, default_flow_style=False, sort_keys=False, allow_unicode=True)
                    safe_write_text(file_path, f"---\n{new_front}---\n\n{body.lstrip()}")
            except Exception:
                pass

    def _sync_single_uid(self, imap, uid: bytes, email_account: str, folder_name: str, folder_type: str) -> bool:
        try:
            status, data = imap.uid("fetch", uid, "(RFC822 FLAGS)")
            if status != "OK" or not data or data[0] is None:
                return False

            raw_email = data[0][1]
            flag_str = data[0][0].decode() if isinstance(data[0][0], bytes) else str(data[0][0])

            if "\\Deleted" in flag_str:
                return False

            is_seen = "\\Seen" in flag_str
            is_flagged = "\\Flagged" in flag_str
            msg = email.message_from_bytes(raw_email)

            raw_subject = msg.get("Subject", "")
            # `.strip("<>")` doesn't flatten headers folded with `\r\n` before the
            # `<`; we use sanitize which also strips Windows reserved chars.
            message_id = sanitize_filename_component(msg.get("Message-ID", ""))
            if not message_id:
                date_val = msg.get("Date", "")
                message_id = hashlib.md5(f"{raw_subject}{date_val}".encode()).hexdigest()
            subject = _decode_str(raw_subject)

            # Skip if already in vault (by message_id, regardless of UID)
            if list(self.mail_folder.glob(f"{message_id}_*.md")):
                return False

            body_text, body_html = self._extract_body(msg)

            type_map = {"Received": "Received", "Sent": "Sent", "Draft": "Draft", "Spam": "Spam", "Deleted": "Deleted", "Archived": "Deleted"}
            msg_type = type_map.get(folder_type, "Received")
            category = _detect_category(msg) if msg_type == "Received" else "Main"

            clean = "".join(c for c in subject if c.isalnum() or c in (" ", "-", "_")).strip()[:50]
            filename = f"{message_id}_{clean}.md"
            file_path = self.mail_folder / filename

            metadata = {
                "title": subject,
                "id": message_id,
                "thread_id": message_id,
                "type": msg_type,
                "sender": _decode_str(msg.get("From", "Unknown")),
                "recipients": _decode_str(msg.get("To", "")),
                "cc": _decode_str(msg.get("Cc", "")),
                "bcc": "",
                "date": msg.get("Date", ""),
                "is_read": is_seen,
                "is_starred": is_flagged,
                "has_attachments": False,
                "has_html": bool(body_html),
                "category": category,
                "archived": folder_type in ("Deleted", "Archived"),
                "spam": folder_type == "Spam",
                "account": email_account,
                "imap_uid": uid.decode() if isinstance(uid, bytes) else str(uid),
                "imap_folder": folder_name,
                "database_table_id": "mail",
            }

            yaml_front = yaml.dump(metadata, default_flow_style=False, sort_keys=False, allow_unicode=True)
            safe_write_text(file_path, f"---\n{yaml_front}---\n\n{body_text}\n")
            if body_html:
                safe_write_text(file_path.with_suffix(".html"), body_html)

            log.info(f"[IMAP] Nou: {filename} [{category}]")
            return True

        except Exception as e:
            log.error(f"[IMAP] Error downloading UID {uid}: {e}")
            return False

    def _extract_body(self, msg) -> tuple[str, str]:
        body_text = ""
        body_html = ""
        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                cd = str(part.get("Content-Disposition", ""))
                if "attachment" in cd:
                    continue
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or "utf-8"
                        if isinstance(charset, str):
                            charset = charset.strip().strip('"').strip("'").lower()
                            if charset in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                                charset = "utf-8"
                        try:
                            text = payload.decode(charset, errors="replace")
                        except LookupError:
                            text = payload.decode("latin1", errors="replace")
                        except Exception:
                            text = payload.decode("utf-8", errors="replace")
                        if ct == "text/html" and not body_html:
                            body_html = text
                        elif ct == "text/plain" and not body_text:
                            body_text = text
                except Exception:
                    pass
        else:
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    charset = msg.get_content_charset() or "utf-8"
                    if isinstance(charset, str):
                        charset = charset.strip().strip('"').strip("'").lower()
                        if charset in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
                            charset = "utf-8"
                    try:
                        body_text = payload.decode(charset, errors="replace")
                    except LookupError:
                        body_text = payload.decode("latin1", errors="replace")
                    except Exception:
                        body_text = payload.decode("utf-8", errors="replace")
            except Exception:
                pass

        if not body_text and body_html:
            try:
                from bs4 import BeautifulSoup
                body_text = BeautifulSoup(body_html, "html.parser").get_text(separator="\n", strip=True)
            except ImportError:
                import re
                body_text = re.sub(r"<[^>]+>", " ", body_html).strip()

        return body_text, body_html

    # ------------------------------------------------------------------
    # PUSH OPERATIONS (Vault → IMAP server)
    # ------------------------------------------------------------------

    def _find_vault_file(self, message_id: str) -> Optional[Path]:
        if not self.mail_folder:
            return None
        files = list(self.mail_folder.glob(f"{message_id}_*.md"))
        if not files:
            files = [f for f in self.mail_folder.glob("*.md") if message_id in f.stem]
        return files[0] if files else None

    def _parse_meta(self, content: str) -> dict:
        import re as _re
        m = _re.search(r"^---\s*\r?\n(.*?)\r?\n---", content, _re.DOTALL)
        if m:
            try:
                data = yaml.safe_load(m.group(1))
                # A scalar frontmatter (e.g. loose text) makes safe_load return a str/int
                # truthy, not a dict, and `... or {}` let it through: then `meta.update(...)`
                # / `meta.get(...)` in the callers (e.g. _update_vault_file) crashed with
                # AttributeError during the sync. We ALWAYS guarantee a dict.
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
        return {}

    def _update_vault_file(self, file_path: Path, updates: dict):
        content = file_path.read_text(encoding="utf-8")
        meta = self._parse_meta(content)
        body_parts = content.split("---\n", 2)
        body = body_parts[-1] if len(body_parts) >= 3 else ""
        meta.update(updates)
        new_front = yaml.dump(meta, default_flow_style=False, sort_keys=False, allow_unicode=True)
        safe_write_text(file_path, f"---\n{new_front}---\n\n{body.lstrip()}")

    def _move_on_server(self, imap, uid: str, from_folder: str, to_folder: str) -> bool:
        """COPY + STORE \Deleted + EXPUNGE (compatible with all IMAP servers)."""
        try:
            imap.select(_imap_name(from_folder))
            uid_b = uid.encode() if isinstance(uid, str) else uid

            # Try MOVE extension first (faster)
            try:
                status, _ = imap.uid("MOVE", uid_b, _imap_name(to_folder))
                if status == "OK":
                    return True
            except Exception:
                pass

            # Fallback: COPY + delete
            status, _ = imap.uid("copy", uid_b, _imap_name(to_folder))
            if status != "OK":
                log.error(f"[IMAP] COPY fallat de {from_folder} a {to_folder} per UID {uid}")
                return False
            imap.uid("store", uid_b, "+FLAGS", "\\Deleted")
            imap.expunge()
            return True
        except Exception as e:
            log.error(f"[IMAP] Error moving UID {uid} from {from_folder} to {to_folder}: {e}")
            return False

    def _find_server_folder(self, imap, target_type: str) -> Optional[str]:
        """Find the actual folder name for a given target type (Deleted/Archived)."""
        folders = _discover_folders(imap)
        for name, ftype in folders:
            if ftype == target_type:
                return name
        # Fallback: try preference list by name
        for candidate in _TYPE_FOLDER_PREFERENCE.get(target_type, []):
            try:
                st, _ = imap.select(_imap_name(candidate), readonly=True)
                if st == "OK":
                    return candidate
            except Exception:
                pass
        return None

    def list_folders(self, email_account: str) -> list[dict]:
        """Return available folders for an account as [{name, type}]."""
        with self._connect(email_account) as imap:
            if imap is None:
                return []
            return [{"name": n, "type": t} for n, t in _discover_folders(imap)]

    def list_all_raw_folders(self, email_account: str) -> list[str]:
        """Return ALL folder names from the IMAP server, without type filtering."""
        with self._connect(email_account) as imap:
            if imap is None:
                return []
            status, folder_list = imap.list()
            if status != "OK":
                return []
            names = []
            for raw in folder_list:
                line = raw.decode() if isinstance(raw, bytes) else raw
                parts = line.split('"')
                if len(parts) < 3:
                    continue
                name = parts[-2] if parts[-1].strip() == "" else parts[-1]
                name = name.strip().strip('"')
                if name:
                    names.append(name)
            log.info(f"[IMAP] All folders for {email_account}: {names}")
            return names

    def move_message(self, email_account: str, message_id: str, target_folder: str) -> bool:
        """Move a message to any folder on the IMAP server and update vault."""
        vault_file = self._find_vault_file(message_id)
        if not vault_file:
            return False

        meta = self._parse_meta(vault_file.read_text(encoding="utf-8"))
        uid = meta.get("imap_uid")
        from_folder = meta.get("imap_folder")

        if not uid or not from_folder:
            log.warning(f"[IMAP] Message {message_id} has no UID or folder; cannot move it on the server")
            return False

        if from_folder.lower() == target_folder.lower():
            return True

        with self._connect(email_account) as imap:
            if imap is None:
                return False

            # Verify target folder exists
            folders = _discover_folders(imap)
            folder_names = [n for n, _ in folders]
            if target_folder not in folder_names:
                log.error(f"[IMAP] Destination folder not found: {target_folder}")
                return False

            target_type = next((t for n, t in folders if n == target_folder), "Received")

            ok = self._move_on_server(imap, uid, from_folder, target_folder)
            if not ok:
                return False

            # Update vault metadata to reflect new folder/type
            type_map = {"Received": "Received", "Sent": "Sent", "Draft": "Draft",
                        "Spam": "Spam", "Deleted": "Deleted", "Archived": "Deleted"}
            updates = {
                "imap_folder": target_folder,
                "type": type_map.get(target_type, "Received"),
                "archived": target_type in ("Deleted", "Archived"),
                "spam": target_type == "Spam",
            }
            # After MOVE the destination server assigns a new UID. Recover it
            # by searching the destination folder with the original Message-ID.
            new_uid = self._lookup_uid_by_message_id(imap, target_folder, message_id)
            updates["imap_uid"] = new_uid if new_uid else ""
            if not new_uid:
                log.warning(
                    f"[IMAP] Could not recover the new UID in {target_folder} "
                    f"for Message-ID {message_id}; a later reconciliation will reassign it."
                )
            self._update_vault_file(vault_file, updates)
            log.info(f"[IMAP] Message {message_id} moved from {from_folder} to {target_folder}")
        return True

    def _lookup_uid_by_message_id(self, imap, folder_name: str, message_id: str) -> Optional[str]:
        """Look up the IMAP UID of a message in a folder by its RFC822 Message-ID.

        Used after a MOVE to recover the new UID assigned by the destination
        server within the same IMAP transaction. Returns None on failure.
        """
        try:
            status, _ = imap.select(_imap_name(folder_name))
            if status != "OK":
                return None
            # Build the full <Message-ID> header value (with angle brackets if missing)
            mid = message_id
            if not mid.startswith("<"):
                mid = f"<{mid}>"
            status, data = imap.uid("search", None, "HEADER", "Message-ID", mid)
            if status != "OK" or not data or not data[0]:
                return None
            uids = data[0].split()
            if not uids:
                return None
            # Return the highest UID (most recent match) decoded as string
            last = uids[-1]
            return last.decode() if isinstance(last, bytes) else str(last)
        except Exception as e:
            log.debug(f"[IMAP] Error looking up UID by Message-ID {message_id} in {folder_name}: {e}")
            return None

    def move_message_by_uid(self, email_account: str, uid: str, from_folder: str, target_folder: str) -> bool:
        """Move a message directly by UID and folder (no vault lookup required)."""
        if from_folder.lower() == target_folder.lower():
            return True
        with self._connect(email_account) as imap:
            if imap is None:
                return False
            folders = _discover_folders(imap)
            folder_names = [n for n, _ in folders]
            if target_folder not in folder_names:
                log.error(f"[IMAP] Destination folder not found: {target_folder}")
                return False
            ok = self._move_on_server(imap, uid, from_folder, target_folder)
            if ok:
                log.info(f"[IMAP] Message UID {uid} moved from {from_folder} to {target_folder}")
            return ok

    def trash_message(self, email_account: str, message_id: str, imap_folder: Optional[str] = None) -> bool:
        """Move message to Trash on server and update vault."""
        vault_file = self._find_vault_file(message_id)

        if vault_file:
            meta = self._parse_meta(vault_file.read_text(encoding="utf-8"))
            uid = meta.get("imap_uid")
            from_folder = meta.get("imap_folder") or imap_folder
            self._update_vault_file(vault_file, {"type": "Deleted", "archived": True})
        else:
            # Hybrid message (not in the vault): extract UID from the imap_ prefix
            raw = message_id[5:] if message_id.startswith("imap_") else message_id
            uid = raw
            from_folder = imap_folder

        if not uid or not from_folder:
            log.warning(f"[IMAP] Message {message_id} has no UID or folder; cannot move it on the server")
            return bool(vault_file)

        with self._connect(email_account) as imap:
            if imap is None:
                return bool(vault_file)
            to_folder = self._find_server_folder(imap, "Deleted")
            if not to_folder:
                log.warning(f"[IMAP] Trash folder not found for {email_account}")
                return bool(vault_file)
            if from_folder.lower() == to_folder.lower():
                return True  # already in trash
            ok = self._move_on_server(imap, uid, from_folder, to_folder)
            if ok and vault_file:
                self._update_vault_file(vault_file, {"imap_folder": to_folder})
                log.info(f"[IMAP] Message {message_id} moved to {to_folder}")
        return True

    def archive_message(self, email_account: str, message_id: str, imap_folder: Optional[str] = None) -> bool:
        """Move message to Archive on server and update vault."""
        vault_file = self._find_vault_file(message_id)

        if vault_file:
            meta = self._parse_meta(vault_file.read_text(encoding="utf-8"))
            uid = meta.get("imap_uid")
            from_folder = meta.get("imap_folder") or imap_folder
            self._update_vault_file(vault_file, {"archived": True})
        else:
            raw = message_id[5:] if message_id.startswith("imap_") else message_id
            uid = raw
            from_folder = imap_folder

        if not uid or not from_folder:
            return bool(vault_file)

        with self._connect(email_account) as imap:
            if imap is None:
                return bool(vault_file)
            to_folder = self._find_server_folder(imap, "Archived")
            if not to_folder:
                log.warning(f"[IMAP] Archive folder not found for {email_account}")
                return bool(vault_file)
            if from_folder.lower() == to_folder.lower():
                return True
            ok = self._move_on_server(imap, uid, from_folder, to_folder)
            if ok and vault_file:
                self._update_vault_file(vault_file, {"imap_folder": to_folder})
                log.info(f"[IMAP] Message {message_id} archived in {to_folder}")
        return True

    def star_message(self, email_account: str, message_id: str, starred: bool) -> bool:
        """Set/unset \\Flagged on server and update vault."""
        vault_file = self._find_vault_file(message_id)
        if not vault_file:
            return False

        meta = self._parse_meta(vault_file.read_text(encoding="utf-8"))
        uid = meta.get("imap_uid")
        folder = meta.get("imap_folder")

        self._update_vault_file(vault_file, {"is_starred": starred})

        if not uid or not folder:
            return True

        with self._connect(email_account) as imap:
            if imap is None:
                return True
            try:
                imap.select(_imap_name(folder))
                uid_b = uid.encode() if isinstance(uid, str) else uid
                flag_op = "+FLAGS" if starred else "-FLAGS"
                imap.uid("store", uid_b, flag_op, "\\Flagged")
                log.info(f"[IMAP] \\Flagged {'afegit' if starred else 'tret'} per UID {uid}")
            except Exception as e:
                log.error(f"[IMAP] Error updating \\Flagged: {e}")
        return True

    def mark_read(
        self,
        email_account: str,
        message_id: str,
        is_read: bool,
        imap_uid: str | None = None,
        imap_folder: str | None = None,
    ) -> bool:
        """Set/unset \\Seen on server and update vault.

        If there is no vault file but the caller gives us `imap_uid` and `imap_folder`
        (or `message_id` is `imap_<UID>` and we can assume INBOX), we apply the
        flag directly on the server without going through the vault. This way emails
        that haven't been synced to the vault yet can also be marked as
        read — and the sidebar (which queries `STATUS UNSEEN` on the server)
        sees the change on the next counts request.
        
        """
        vault_file = self._find_vault_file(message_id)
        uid: str | None = None
        folder: str | None = None

        if vault_file:
            meta = self._parse_meta(vault_file.read_text(encoding="utf-8"))
            uid = meta.get("imap_uid")
            folder = meta.get("imap_folder")
            self._update_vault_file(vault_file, {"is_read": is_read})

        # Fallback: if we don't have uid/folder via the vault, use them from the args
        # from the caller or derive them from message_id (`imap_<UID>` in INBOX).
        if not uid:
            uid = imap_uid or (message_id[5:] if message_id.startswith("imap_") else None)
        if not folder:
            folder = imap_folder or "INBOX"

        if not uid:
            # Without a uid the server can't be touched; only the case of a missing vault_file
            # and message_id without the imap_ prefix. We consider it failed so the
            # caller can still invalidate caches through other paths.
            return bool(vault_file)

        with self._connect(email_account) as imap:
            if imap is None:
                return bool(vault_file)
            try:
                imap.select(_imap_name(folder))
                uid_b = uid.encode() if isinstance(uid, str) else uid
                flag_op = "+FLAGS" if is_read else "-FLAGS"
                imap.uid("store", uid_b, flag_op, "\\Seen")
                log.info(f"[IMAP] \\Seen {'afegit' if is_read else 'tret'} per UID {uid} a {folder}")
            except Exception as e:
                log.error(f"[IMAP] Error updating \\Seen: {e}")
                return bool(vault_file)
        return True

    def empty_folder(self, email_account: str, folder_name: str, permanent: bool = True) -> bool:
        """Permanently delete all messages in a folder (if permanent=True) or move them to Trash."""
        with self._connect(email_account) as imap:
            if imap is None: return False
            try:
                imap.select(_imap_name(folder_name))
                st, data = imap.uid("search", None, "ALL")
                if st != "OK" or not data[0]:
                    return True
                
                uids = data[0].split()
                if not uids:
                    return True

                uids_str = b",".join(uids).decode()
                
                if permanent:
                    imap.uid("store", uids_str, "+FLAGS", "\\Deleted")
                    imap.expunge()
                else:
                    # Move to trash
                    to_folder = self._find_server_folder(imap, "Deleted")
                    if to_folder:
                        for uid in uids:
                            self._move_on_server(imap, uid, folder_name, to_folder)
                
                # Cleanup local vault files
                if self.mail_folder:
                    for f in list(self.mail_folder.glob("*.md")):
                        try:
                            content = f.read_text(encoding="utf-8")
                            if f'account: {email_account}' in content and f'imap_folder: {folder_name}' in content:
                                f.unlink(missing_ok=True)
                                h = f.with_suffix(".html")
                                if h.exists(): h.unlink(missing_ok=True)
                        except Exception as ex:
                            log.debug(f"[IMAP] Failed to clean local file {f}: {ex}")
                return True
            except Exception as e:
                log.error(f"[IMAP] Error emptying folder {folder_name}: {e}")
                return False

    # ------------------------------------------------------------------
    # DRAFTS — APPEND a [Gmail]/Drafts (o equivalent IMAP)
    # ------------------------------------------------------------------

    def append_draft(
        self,
        email_account: str,
        to: str,
        subject: str,
        body: str,
        cc: str = "",
        bcc: str = "",
        replace_uid: Optional[str] = None,
    ) -> Optional[str]:
        """APPEND a message with the \\Draft flag to the account's Drafts folder.

        If `replace_uid` is set, tries to delete the old version
        (auto-save: the user types and the draft is updated every N seconds).

        Returns the UID of the draft persisted on the server, or None if it failed.
        
        """
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        import time

        with self._connect(email_account) as imap:
            if imap is None:
                return None

            drafts_folder = self._find_server_folder(imap, "Draft")
            if not drafts_folder:
                log.warning(f"[IMAP] Drafts folder not found for {email_account}")
                return None

            content_type = "html" if body.strip().startswith("<") else "plain"
            msg = MIMEMultipart("alternative") if content_type == "html" else MIMEText(body, content_type, "utf-8")
            if isinstance(msg, MIMEMultipart):
                msg.attach(MIMEText(body, "html", "utf-8"))
            msg["From"] = email_account
            msg["To"] = to or ""
            msg["Subject"] = subject or ""
            if cc:
                msg["Cc"] = cc
            if bcc:
                msg["Bcc"] = bcc
            msg["Date"] = email.utils.formatdate(localtime=True)

            raw_bytes = msg.as_bytes()

            try:
                # Delete the previous version before adding the new one (auto-save)
                if replace_uid:
                    try:
                        imap.select(_imap_name(drafts_folder))
                        uid_b = replace_uid.encode() if isinstance(replace_uid, str) else replace_uid
                        imap.uid("store", uid_b, "+FLAGS", "\\Deleted")
                        imap.expunge()
                    except Exception as e:
                        log.debug(f"[IMAP] Could not delete old draft UID={replace_uid}: {e}")

                # APPEND with the \Draft flag. RFC 3501 section 6.3.11.
                date_time = imaplib.Time2Internaldate(time.time())
                status, data = imap.append(
                    _imap_name(drafts_folder),
                    "(\\Draft)",
                    date_time,
                    raw_bytes,
                )
                if status != "OK":
                    log.error(f"[IMAP] APPEND draft fallit: {status} {data}")
                    return None

                # We retrieve the assigned UID. Gmail/IMAP report APPENDUID if the
                # server supports UIDPLUS (RFC 4315). Fallback: search by the
                # Message-ID we just generated.
                new_uid = None
                if data and isinstance(data[0], bytes):
                    txt = data[0].decode("utf-8", errors="replace")
                    m = re.search(r"\[APPENDUID\s+\d+\s+(\d+)\]", txt)
                    if m:
                        new_uid = m.group(1)

                if not new_uid:
                    # Fallback: search by most recent Date + Subject
                    try:
                        imap.select(_imap_name(drafts_folder))
                        st, d = imap.uid("search", None, "ALL")
                        if st == "OK" and d and d[0]:
                            uids = d[0].split()
                            if uids:
                                new_uid = uids[-1].decode() if isinstance(uids[-1], bytes) else str(uids[-1])
                    except Exception:
                        pass

                log.info(f"[IMAP] Draft afegit a {drafts_folder} per {email_account} (UID={new_uid})")
                return new_uid
            except Exception as e:
                log.error(f"[IMAP] Error fent APPEND a {drafts_folder}: {e}")
                return None

    # ------------------------------------------------------------------
    # THREADING — Gmail X-GM-THRID via IMAP
    # ------------------------------------------------------------------

    def fetch_thread_by_gm_thrid(self, email_account: str, gm_thrid: str) -> list[dict]:
        """Returns all messages in a Gmail thread (X-GM-THRID) via IMAP.

        Only works for Google accounts (Gmail IMAP supports X-GM-EXT-1
        with X-GM-MSGID, X-GM-THRID, X-GM-LABELS capabilities).

        Searches "All Mail" because it contains messages from all folders
        of the same thread (INBOX + SENT, e.g.).
        
        """
        with self._connect(email_account) as imap:
            if imap is None:
                return []

            # Check X-GM-EXT-1 capability.
            try:
                _, caps_data = imap.capability()
                caps = b" ".join(caps_data).decode().upper() if caps_data else ""
                if "X-GM-EXT-1" not in caps:
                    log.debug(f"[IMAP] Server without X-GM-EXT-1 for {email_account}")
                    return []
            except Exception:
                return []

            # "[Gmail]/All Mail" contains all messages (INBOX + SENT + archive).
            # The localized name varies: we try the \All flag first.
            all_mail = self._find_server_folder(imap, "Archived") or "[Gmail]/All Mail"
            try:
                status, _ = imap.select(_imap_name(all_mail), readonly=True)
                if status != "OK":
                    log.warning(f"[IMAP] Could not select {all_mail}")
                    return []

                # Search by X-GM-THRID. Format: `X-GM-THRID 1234567890123456789`
                status, data = imap.uid("search", None, f"X-GM-THRID {gm_thrid}")
                if status != "OK" or not data or not data[0]:
                    return []

                uids = data[0].split()
                if not uids:
                    return []

                uid_str = b",".join(uids).decode()
                status, fetch_data = imap.uid(
                    "fetch", uid_str,
                    "(FLAGS X-GM-THRID X-GM-LABELS BODY.PEEK[HEADER])",
                )
                if status != "OK":
                    return []

                messages = []
                for part in fetch_data:
                    if not isinstance(part, tuple):
                        continue
                    info = part[0].decode("utf-8", errors="replace")
                    uid_m = re.search(r"UID (\d+)", info)
                    if not uid_m:
                        continue
                    uid = uid_m.group(1)
                    flags_m = re.search(r"FLAGS \(([^)]*)\)", info)
                    flags = (flags_m.group(1) if flags_m else "").lower()

                    msg_obj = email.message_from_bytes(part[1])
                    raw_subject = msg_obj.get("Subject", "")
                    raw_from = msg_obj.get("From", "")
                    raw_to = msg_obj.get("To", "")
                    raw_date = msg_obj.get("Date", "")

                    # Decode MIME headers
                    def _dec(v):
                        return _decode_str(v) if v else ""

                    messages.append({
                        "id": f"imap_{uid}",
                        "imap_uid": uid,
                        "subject": _dec(raw_subject) or "(sense assumpte)",
                        "sender": _dec(raw_from),
                        "recipient": _dec(raw_to),
                        "date": raw_date,
                        "is_read": "\\seen" in flags,
                        "is_starred": "\\flagged" in flags,
                        "imap_folder": all_mail,
                        "source": "imap",
                        "account": email_account,
                        "gm_thrid": gm_thrid,
                    })

                # Chronological order: mail APIs usually show oldest first in the thread
                from email.utils import parsedate_to_datetime
                def _ts(m):
                    try:
                        return parsedate_to_datetime(m.get("date", "")).timestamp()
                    except Exception:
                        return 0
                messages.sort(key=_ts)
                return messages
            except Exception as e:
                log.error(f"[IMAP] Error retrieving thread {gm_thrid} for {email_account}: {e}")
                return []


imap_sync_service = ImapMailSyncService()


def imap_smtp_send(
    account: dict,
    to: str,
    subject: str,
    body: str,
    cc: str = None,
    bcc: str = None,
    attachments: list = None,
    from_email: str = None,
    from_name: str = None,
    inline_images: list = None,
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

    # Resolve defaults (Google → smtp.gmail.com, etc.)
    account = integration_manager.resolve_imap_defaults(account)
    is_oauth = integration_manager.is_imap_oauth_account(account)

    smtp_host = account.get("smtp_host", "")
    smtp_port = int(account.get("smtp_port", 465))
    smtp_user = account.get("smtp_user") or account.get("imap_user") or account.get("email", "")
    smtp_pass = account.get("smtp_password") or account.get("imap_password", "")
    smtp_enc = (account.get("smtp_encryption") or "ssl").lower()
    sender_email = from_email or account.get("email") or smtp_user
    sender_display = from_name or account.get("display_name") or ""
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

    access_token = None
    if is_oauth:
        from backend.services.oauth2_helpers import ensure_fresh_token, OAuth2RefreshError
        try:
            access_token, _ = ensure_fresh_token(account.get("email"))
        except OAuth2RefreshError as e:
            log.error(f"[SMTP-XOAUTH2] {e}")
            return False
        if not access_token:
            log.error(f"[SMTP-XOAUTH2] Missing access_token for {account.get('email')}")
            return False

    def _authenticate(server):
        if is_oauth:
            from backend.services.oauth2_helpers import xoauth2_smtp_login
            xoauth2_smtp_login(server, account.get("email"), access_token)
        elif smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)

    try:
        ctx = ssl.create_default_context()
        # timeout=30 prevents a hung SMTP server from blocking the thread
        # from FastAPI for minutes (the user clicks "Send" and nothing comes back).
        if smtp_enc == "ssl":
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx, timeout=30) as server:
                server.ehlo()
                _authenticate(server)
                server.sendmail(sender_email, recipients, msg.as_bytes())
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
                server.ehlo()
                if smtp_enc == "starttls":
                    server.starttls(context=ctx)
                    server.ehlo()
                _authenticate(server)
                server.sendmail(sender_email, recipients, msg.as_bytes())
        log.info(f"[SMTP{'-XOAUTH2' if is_oauth else ''}] Message sent from {sender_email} to {to}")
        return True
    except Exception as e:
        log.error(f"[SMTP] Error sending from {sender_email}: {e}")
        return False
