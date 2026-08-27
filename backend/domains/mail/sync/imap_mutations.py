"""IMAP server mutation operations."""

from __future__ import annotations

import email
import email.utils
import imaplib
import logging
import re
import time
from typing import Any, Optional

from backend.domains.mail.sync.imap_core import ImapMailSyncCore
from backend.domains.mail.sync.imap_protocol import (
    _TYPE_FOLDER_PREFERENCE,
    _decode_str,
    _discover_folders,
    _imap_name,
)

log = logging.getLogger(__name__)


def _delete_previous_draft(imap: Any, drafts_folder: str, replace_uid: str | None) -> None:
    if not replace_uid:
        return
    try:
        imap.select(_imap_name(drafts_folder))
        imap.uid("store", replace_uid.encode(), "+FLAGS", "\\Deleted")
        imap.expunge()
    except Exception as exc:
        log.debug(f"[IMAP] Could not delete old draft UID={replace_uid}: {exc}")


def _append_uid(data: Any) -> str | None:
    if not data or not isinstance(data[0], bytes):
        return None
    match = re.search(
        r"\[APPENDUID\s+\d+\s+(\d+)\]",
        data[0].decode("utf-8", errors="replace"),
    )
    return match.group(1) if match else None


def _latest_mailbox_uid(imap: Any, drafts_folder: str) -> str | None:
    try:
        imap.select(_imap_name(drafts_folder))
        status, data = imap.uid("search", None, "ALL")
        if status != "OK" or not data or not data[0]:
            return None
        uids = data[0].split()
        if not uids:
            return None
        latest = uids[-1]
        return latest.decode() if isinstance(latest, bytes) else str(latest)
    except Exception:
        return None


class ImapMailMutationService(ImapMailSyncCore):
    def _move_on_server(self: Any, imap: Any, uid: str, from_folder: str, to_folder: str) -> bool:
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

    def _find_server_folder(self: Any, imap: Any, target_type: str) -> Optional[str]:
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

    def list_folders(self: Any, email_account: str) -> list[dict[str, Any]]:
        """Return available folders for an account as [{name, type}]."""
        with self._connect(email_account) as imap:
            if imap is None:
                return []
            return [{"name": n, "type": t} for n, t in _discover_folders(imap)]

    def list_all_raw_folders(self: Any, email_account: str) -> list[str]:
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

    def move_message(self: Any, email_account: str, message_id: str, target_folder: str) -> bool:
        """Move a message to any folder on the IMAP server and update vault."""
        vault_file = self._find_vault_file(message_id)
        if not vault_file:
            return False

        meta = self._parse_meta(vault_file.read_text(encoding="utf-8"))
        uid = meta.get("imap_uid")
        from_folder = meta.get("imap_folder")

        if not uid or not from_folder:
            log.warning(
                f"[IMAP] Message {message_id} has no UID or folder; cannot move it on the server"
            )
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
            type_map = {
                "Received": "Received",
                "Sent": "Sent",
                "Draft": "Draft",
                "Spam": "Spam",
                "Deleted": "Deleted",
                "Archived": "Deleted",
            }
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

    def _lookup_uid_by_message_id(
        self: Any, imap: Any, folder_name: str, message_id: str
    ) -> Optional[str]:
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
            log.debug(
                f"[IMAP] Error looking up UID by Message-ID {message_id} in {folder_name}: {e}"
            )
            return None

    def move_message_by_uid(
        self: Any, email_account: str, uid: str, from_folder: str, target_folder: str
    ) -> bool:
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
            return bool(ok)

    def trash_message(
        self: Any, email_account: str, message_id: str, imap_folder: Optional[str] | None = None
    ) -> bool:
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
            log.warning(
                f"[IMAP] Message {message_id} has no UID or folder; cannot move it on the server"
            )
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

    def archive_message(
        self: Any, email_account: str, message_id: str, imap_folder: Optional[str] | None = None
    ) -> bool:
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

    def star_message(self: Any, email_account: str, message_id: str, starred: bool) -> bool:
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
        self: Any,
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
                log.info(
                    f"[IMAP] \\Seen {'afegit' if is_read else 'tret'} per UID {uid} a {folder}"
                )
            except Exception as e:
                log.error(f"[IMAP] Error updating \\Seen: {e}")
                return bool(vault_file)
        return True

    def empty_folder(
        self: Any, email_account: str, folder_name: str, permanent: bool = True
    ) -> bool:
        """Permanently delete all messages in a folder (if permanent=True) or move them to Trash."""
        with self._connect(email_account) as imap:
            if imap is None:
                return False
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
                            if (
                                f"account: {email_account}" in content
                                and f"imap_folder: {folder_name}" in content
                            ):
                                f.unlink(missing_ok=True)
                                h = f.with_suffix(".html")
                                if h.exists():
                                    h.unlink(missing_ok=True)
                        except Exception as ex:
                            log.debug(f"[IMAP] Failed to clean local file {f}: {ex}")
                return True
            except Exception as e:
                log.error(f"[IMAP] Error emptying folder {folder_name}: {e}")
                return False

    def append_draft(
        self: Any,
        email_account: str,
        to: str,
        subject: str,
        body: str,
        cc: str = "",
        bcc: str = "",
        replace_uid: Optional[str] | None = None,
    ) -> Optional[str]:
        """APPEND a message with the \\Draft flag to the account's Drafts folder.

        If `replace_uid` is set, tries to delete the old version
        (auto-save: the user types and the draft is updated every N seconds).

        Returns the UID of the draft persisted on the server, or None if it failed.

        """
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        with self._connect(email_account) as imap:
            if imap is None:
                return None

            drafts_folder = self._find_server_folder(imap, "Draft")
            if not drafts_folder:
                log.warning(f"[IMAP] Drafts folder not found for {email_account}")
                return None

            content_type = "html" if body.strip().startswith("<") else "plain"
            msg = (
                MIMEMultipart("alternative")
                if content_type == "html"
                else MIMEText(body, content_type, "utf-8")
            )
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
                _delete_previous_draft(imap, drafts_folder, replace_uid)

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
                new_uid = _append_uid(data) or _latest_mailbox_uid(imap, drafts_folder)

                log.info(
                    f"[IMAP] Draft afegit a {drafts_folder} per {email_account} (UID={new_uid})"
                )
                return new_uid
            except Exception as e:
                log.error(f"[IMAP] Error fent APPEND a {drafts_folder}: {e}")
                return None

    def fetch_thread_by_gm_thrid(
        self: Any, email_account: str, gm_thrid: str
    ) -> list[dict[str, Any]]:
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
                    "fetch",
                    uid_str,
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
                    def _dec(v: Any) -> Any:
                        return _decode_str(v) if v else ""

                    messages.append(
                        {
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
                        }
                    )

                # Chronological order: mail APIs usually show oldest first in the thread
                from email.utils import parsedate_to_datetime

                def _ts(m: Any) -> Any:
                    try:
                        return parsedate_to_datetime(m.get("date", "")).timestamp()
                    except Exception:
                        return 0

                messages.sort(key=_ts)
                return messages
            except Exception as e:
                log.error(f"[IMAP] Error retrieving thread {gm_thrid} for {email_account}: {e}")
                return []
