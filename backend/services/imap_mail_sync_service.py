"""IMAP mail sync service.

Pull sync: downloads new messages, reconciles deleted ones, updates flags.
Push sync: propagates UI actions (trash, archive, star, read) to IMAP server.

Vault metadata added per message:
  imap_uid:    IMAP UID string (stable per folder)
  imap_folder: folder name where the message lives on the server
"""
import imaplib
import email
import hashlib
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
    parts = decode_header(val)
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            result.append(part.decode(enc or "utf-8", errors="replace"))
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
                # Prova el nom base de carpetes jeràrquiques (p.ex. "INBOX.Trash" → "trash")
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
        """Context manager: yields authenticated IMAP connection."""
        account_data = self._get_account_data(email_account)
        if not account_data:
            log.warning(f"[IMAP] Compte no trobat: {email_account}")
            yield None
            return

        imap_host = account_data.get("imap_host")
        imap_port = int(account_data.get("imap_port") or 993)
        imap_user = account_data.get("imap_user") or account_data.get("imap_username")
        imap_password = account_data.get("imap_password")

        if not all([imap_host, imap_user, imap_password]):
            missing = [k for k, v in {"imap_host": imap_host, "imap_user": imap_user, "imap_password": imap_password}.items() if not v]
            log.error(f"[IMAP] Credencials incompletes per a {email_account}. Falten: {missing}")
            yield None
            return

        encryption = account_data.get("imap_encryption", "ssl").lower()
        imap = None
        try:
            socket.setdefaulttimeout(30)
            if encryption == "ssl":
                imap = imaplib.IMAP4_SSL(imap_host, imap_port)
            else:
                imap = imaplib.IMAP4(imap_host, imap_port)
                if encryption == "starttls":
                    imap.starttls()
            imap.login(imap_user, imap_password)
            yield imap
        except imaplib.IMAP4.error as e:
            log.error(f"[IMAP] Error d'autenticació per a {email_account} ({imap_host}:{imap_port}): {e}")
            yield None
        except (socket.gaierror, socket.timeout, ConnectionRefusedError, OSError) as e:
            log.error(f"[IMAP] No s'ha pogut connectar a {imap_host}:{imap_port} per a {email_account}: {e}")
            yield None
        except Exception:
            log.exception(f"[IMAP] Error inesperat connectant per a {email_account}")
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
                log.warning(f"[IMAP] No s'ha pogut seleccionar: {folder_name}")
                return 0
        except Exception as e:
            log.warning(f"[IMAP] Error seleccionant {folder_name}: {e}")
            return 0

        # Get all UIDs on server (excludes \Deleted-flagged)
        try:
            status, uid_data = imap.uid("search", None, "NOT DELETED")
            if status != "OK":
                return 0
            server_uids = set(uid_data[0].split())
            log.info(f"[IMAP] {email_account}/{folder_name} ({folder_type}): {len(server_uids)} missatges al servidor")
        except Exception as e:
            log.error(f"[IMAP] Cerca fallida per {folder_name}: {e}")
            return 0

        # --- Reconcile: remove vault files no longer on server ---
        self._reconcile_folder(email_account, folder_name, server_uids)

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
            log.info(f"[IMAP]   {count} nous missatges descarregats de {folder_name}")

        # --- Sync flags for recent messages already in vault ---
        recent_uids = sorted(server_uids, key=lambda x: int(x) if x.isdigit() else 0, reverse=True)[:limit]
        self._sync_flags(imap, email_account, folder_name, recent_uids)

        return count

    def _reconcile_folder(self, email_account: str, folder_name: str, server_uids: set):
        """Remove vault files whose imap_uid is no longer present on server."""
        if not self.mail_folder:
            return
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
                if uid and uid.encode() not in server_uids and str(uid).encode() not in server_uids:
                    file_path.unlink(missing_ok=True)
                    html = file_path.with_suffix(".html")
                    if html.exists():
                        html.unlink(missing_ok=True)
                    removed += 1
                    log.info(f"[IMAP] Reconciliat (eliminat del servidor): {file_path.name}")
            except Exception as e:
                log.debug(f"[IMAP] Error reconciliant {file_path.name}: {e}")
        if removed:
            log.info(f"[IMAP] Reconciliació {folder_name}: {removed} fitxers eliminats del Vault")

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
                    file_path.write_text(f"---\n{new_front}---\n\n{body.lstrip()}", encoding="utf-8")
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
            message_id = msg.get("Message-ID", "").strip("<>")
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
            file_path.write_text(f"---\n{yaml_front}---\n\n{body_text}\n", encoding="utf-8")
            if body_html:
                file_path.with_suffix(".html").write_text(body_html, encoding="utf-8")

            log.info(f"[IMAP] Nou: {filename} [{category}]")
            return True

        except Exception as e:
            log.error(f"[IMAP] Error descarregant UID {uid}: {e}")
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
                        text = payload.decode(charset, errors="replace")
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
                    body_text = payload.decode(charset, errors="replace")
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
                return yaml.safe_load(m.group(1)) or {}
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
        file_path.write_text(f"---\n{new_front}---\n\n{body.lstrip()}", encoding="utf-8")

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
            log.error(f"[IMAP] Error movent UID {uid} de {from_folder} a {to_folder}: {e}")
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
            log.info(f"[IMAP] Totes les carpetes de {email_account}: {names}")
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
            log.warning(f"[IMAP] Missatge {message_id} sense UID/folder, no es pot moure al servidor")
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
                log.error(f"[IMAP] Carpeta destí no trobada: {target_folder}")
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
            # We need to get the new UID after MOVE (server assigns new UID in destination)
            # For now, remove old UID so reconciliation doesn't delete it
            updates["imap_uid"] = ""
            self._update_vault_file(vault_file, updates)
            log.info(f"[IMAP] Missatge {message_id} mogut de {from_folder} a {target_folder}")
        return True

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
                log.error(f"[IMAP] Carpeta destí no trobada: {target_folder}")
                return False
            ok = self._move_on_server(imap, uid, from_folder, target_folder)
            if ok:
                log.info(f"[IMAP] Missatge UID {uid} mogut de {from_folder} a {target_folder}")
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
            # Missatge híbrid (no al vault): extreu UID del prefix imap_
            raw = message_id[5:] if message_id.startswith("imap_") else message_id
            uid = raw
            from_folder = imap_folder

        if not uid or not from_folder:
            log.warning(f"[IMAP] Missatge {message_id} sense UID/folder, no es pot moure al servidor")
            return bool(vault_file)

        with self._connect(email_account) as imap:
            if imap is None:
                return bool(vault_file)
            to_folder = self._find_server_folder(imap, "Deleted")
            if not to_folder:
                log.warning(f"[IMAP] No s'ha trobat carpeta Trash per a {email_account}")
                return bool(vault_file)
            if from_folder.lower() == to_folder.lower():
                return True  # already in trash
            ok = self._move_on_server(imap, uid, from_folder, to_folder)
            if ok and vault_file:
                self._update_vault_file(vault_file, {"imap_folder": to_folder})
                log.info(f"[IMAP] Missatge {message_id} mogut a {to_folder}")
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
                log.warning(f"[IMAP] No s'ha trobat carpeta Archive per a {email_account}")
                return bool(vault_file)
            if from_folder.lower() == to_folder.lower():
                return True
            ok = self._move_on_server(imap, uid, from_folder, to_folder)
            if ok and vault_file:
                self._update_vault_file(vault_file, {"imap_folder": to_folder})
                log.info(f"[IMAP] Missatge {message_id} arxivat a {to_folder}")
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
                log.error(f"[IMAP] Error actualitzant \\Flagged: {e}")
        return True

    def mark_read(self, email_account: str, message_id: str, is_read: bool) -> bool:
        """Set/unset \\Seen on server and update vault."""
        vault_file = self._find_vault_file(message_id)
        if not vault_file:
            return False

        meta = self._parse_meta(vault_file.read_text(encoding="utf-8"))
        uid = meta.get("imap_uid")
        folder = meta.get("imap_folder")

        self._update_vault_file(vault_file, {"is_read": is_read})

        if not uid or not folder:
            return True

        with self._connect(email_account) as imap:
            if imap is None:
                return True
            try:
                imap.select(_imap_name(folder))
                uid_b = uid.encode() if isinstance(uid, str) else uid
                flag_op = "+FLAGS" if is_read else "-FLAGS"
                imap.uid("store", uid_b, flag_op, "\\Seen")
                log.info(f"[IMAP] \\Seen {'afegit' if is_read else 'tret'} per UID {uid}")
            except Exception as e:
                log.error(f"[IMAP] Error actualitzant \\Seen: {e}")
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
                        except Exception: pass
                return True
            except Exception as e:
                log.error(f"[IMAP] Error buidant carpeta {folder_name}: {e}")
                return False


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
) -> bool:
    """Send a message via SMTP using an IMAP account's SMTP config."""
    import smtplib
    import ssl
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.base import MIMEBase
    from email import encoders
    from email.utils import formataddr

    smtp_host = account.get("smtp_host", "")
    smtp_port = int(account.get("smtp_port", 465))
    smtp_user = account.get("smtp_user") or account.get("imap_user", "")
    smtp_pass = account.get("smtp_password") or account.get("imap_password", "")
    smtp_enc = (account.get("smtp_encryption") or "ssl").lower()
    sender_email = from_email or account.get("email") or smtp_user
    sender_display = from_name or account.get("display_name") or ""
    from_header = formataddr((sender_display, sender_email)) if sender_display else sender_email

    if not smtp_host:
        log.error("[SMTP] smtp_host no configurat")
        return False

    content_type = "html" if body.strip().startswith("<") else "plain"
    if attachments:
        msg = MIMEMultipart("mixed")
        msg.attach(MIMEText(body, content_type, "utf-8"))
        for att in attachments:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(att["data"])
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{att["filename"]}"')
            part.add_header("Content-Type", att.get("content_type", "application/octet-stream"))
            msg.attach(part)
    else:
        msg = MIMEText(body, content_type, "utf-8")

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

    try:
        ctx = ssl.create_default_context()
        if smtp_enc == "ssl":
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=ctx) as server:
                if smtp_user and smtp_pass:
                    server.login(smtp_user, smtp_pass)
                server.sendmail(sender_email, recipients, msg.as_bytes())
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.ehlo()
                if smtp_enc == "starttls":
                    server.starttls(context=ctx)
                    server.ehlo()
                if smtp_user and smtp_pass:
                    server.login(smtp_user, smtp_pass)
                server.sendmail(sender_email, recipients, msg.as_bytes())
        log.info(f"[SMTP] Missatge enviat de {sender_email} a {to}")
        return True
    except Exception as e:
        log.error(f"[SMTP] Error enviant de {sender_email}: {e}")
        return False
