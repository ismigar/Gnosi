"""IMAP pull synchronization and vault persistence."""

from __future__ import annotations

import email
import email.utils
import hashlib
import imaplib
import logging
import re
import socket
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

import yaml

from backend.config.app_config import load_params
from backend.domains.mail.sync.imap_protocol import (
    _decode_str,
    _detect_category,
    _discover_folders,
    _imap_name,
)
from backend.services.integration_manager import integration_manager
from backend.utils.safe_io import safe_write_text, sanitize_filename_component

log = logging.getLogger(__name__)


def _decode_message_payload(payload: Any, charset: Any) -> str | None:
    if not isinstance(payload, (bytes, bytearray)) or not payload:
        return None
    payload_bytes = bytes(payload)
    normalized = charset or "utf-8"
    if isinstance(normalized, str):
        normalized = normalized.strip().strip('"').strip("'").lower()
        if normalized in ("unknown-8bit", "unknown", "x-unknown", "attachment"):
            normalized = "utf-8"
    try:
        return payload_bytes.decode(normalized, errors="replace")
    except LookupError:
        return payload_bytes.decode("latin1", errors="replace")
    except Exception:
        return payload_bytes.decode("utf-8", errors="replace")


def _extract_multipart_body(msg: Any) -> tuple[str, str]:
    body_text = body_html = ""
    for part in msg.walk():
        if "attachment" in str(part.get("Content-Disposition", "")):
            continue
        try:
            decoded = _decode_message_payload(
                part.get_payload(decode=True), part.get_content_charset()
            )
        except Exception:
            continue
        if decoded is None:
            continue
        content_type = part.get_content_type()
        if content_type == "text/html" and not body_html:
            body_html = decoded
        elif content_type == "text/plain" and not body_text:
            body_text = decoded
    return body_text, body_html


def _html_to_plain_text(body_html: str) -> str:
    try:
        from bs4 import BeautifulSoup

        return str(BeautifulSoup(body_html, "html.parser").get_text(separator="\n", strip=True))
    except ImportError:
        return re.sub(r"<[^>]+>", " ", body_html).strip()


class ImapMailSyncCore:
    def __init__(self: Any) -> None:
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

    def _get_account_data(self: Any, email_account: str) -> dict[str, Any] | None:
        integrations = integration_manager.get_raw("mail_accounts")
        return next((a for a in integrations if a.get("email") == email_account), None)

    @contextmanager
    def _connect(self: Any, email_account: str) -> Any:
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

        imap_host = str(account_data.get("imap_host") or "")
        imap_port = int(account_data.get("imap_port") or 993)
        imap_user = str(
            account_data.get("imap_user") or account_data.get("imap_username") or email_account
        )
        imap_password = str(account_data.get("imap_password") or "")

        if not imap_host or not imap_user:
            log.error(f"[IMAP] Missing host or user for {email_account}")
            yield None
            return

        if not is_oauth and not imap_password:
            log.error(f"[IMAP] No password for {email_account} (non-OAuth)")
            yield None
            return

        encryption = str(account_data.get("imap_encryption") or "ssl").lower()
        imap: imaplib.IMAP4 | None = None
        try:
            if encryption == "ssl":
                imap = imaplib.IMAP4_SSL(imap_host, imap_port, timeout=30)
            else:
                imap = imaplib.IMAP4(imap_host, imap_port, timeout=30)
                if encryption == "starttls":
                    imap.starttls()

            if is_oauth:
                from backend.services.oauth2_helpers import (
                    OAuth2RefreshError,
                    ensure_fresh_token,
                    xoauth2_imap_login,
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
            log.error(
                f"[IMAP] Authentication error for {email_account} ({imap_host}:{imap_port}): {e}"
            )
            yield None
        except (socket.gaierror, socket.timeout, ConnectionRefusedError, OSError) as e:
            log.error(
                f"[IMAP] Could not connect to {imap_host}:{imap_port} for {email_account}: {e}"
            )
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

    def sync_account(
        self: Any, email_account: str, limit: int = 50, folder_type: Optional[str] | None = None
    ) -> Optional[int]:
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
                total_synced += self._sync_folder(imap, email_account, folder_name, ft, limit)

        self._last_sync[cache_key] = now
        return total_synced

    def _sync_folder(
        self: Any, imap: Any, email_account: str, folder_name: str, folder_type: str, limit: int
    ) -> int:
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
            log.info(
                f"[IMAP] {email_account}/{folder_name} ({folder_type}): "
                f"{len(server_uids)} messages on server"
            )
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
        recent_uids = sorted(server_uids, key=lambda x: int(x) if x.isdigit() else 0, reverse=True)[
            :limit
        ]
        self._sync_flags(imap, email_account, folder_name, recent_uids)

        return count

    def _reconcile_folder(
        self: Any, email_account: str, folder_name: str, server_uids: set[Any]
    ) -> Any:
        """Remove vault files whose imap_uid is no longer present on server.

        Note: this iterates filesystem operations, not DB rows. There is no
        SQL transaction to wrap. If the process crashes mid-loop, the next
        sync will reconcile any leftover files (idempotent by design).
        """
        if not self.mail_folder:
            return

        # Normalise server_uids to a set of strings so comparison is unambiguous.
        # imap.uid("search") returns bytes, but downstream code may pass strings.
        normalized_server_uids: set[str] = set()
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
            log.info(
                f"[IMAP] Reconciliation for {folder_name}: {removed} files deleted from the Vault"
            )

    def _get_vault_uids(self: Any, email_account: str, folder_name: str) -> set[Any]:
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

    def _sync_flags(
        self: Any, imap: Any, email_account: str, folder_name: str, uids: list[Any]
    ) -> Any:
        r"""Update \Seen and \Flagged flags in vault for recently active messages."""
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
                    new_front = yaml.dump(
                        meta, default_flow_style=False, sort_keys=False, allow_unicode=True
                    )
                    safe_write_text(file_path, f"---\n{new_front}---\n\n{body.lstrip()}")
            except Exception:
                pass

    def _sync_single_uid(
        self: Any, imap: Any, uid: bytes, email_account: str, folder_name: str, folder_type: str
    ) -> bool:
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

            type_map = {
                "Received": "Received",
                "Sent": "Sent",
                "Draft": "Draft",
                "Spam": "Spam",
                "Deleted": "Deleted",
                "Archived": "Deleted",
            }
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

            yaml_front = yaml.dump(
                metadata, default_flow_style=False, sort_keys=False, allow_unicode=True
            )
            safe_write_text(file_path, f"---\n{yaml_front}---\n\n{body_text}\n")
            if body_html:
                safe_write_text(file_path.with_suffix(".html"), body_html)

            log.info(f"[IMAP] Nou: {filename} [{category}]")
            return True

        except Exception as e:
            uid_text = uid.decode(errors="replace") if isinstance(uid, bytes) else str(uid)
            log.error(f"[IMAP] Error downloading UID {uid_text}: {e}")
            return False

    def _extract_body(self: Any, msg: Any) -> tuple[str, str]:
        if msg.is_multipart():
            body_text, body_html = _extract_multipart_body(msg)
        else:
            body_text = (
                _decode_message_payload(msg.get_payload(decode=True), msg.get_content_charset())
                or ""
            )
            body_html = ""

        if not body_text and body_html:
            body_text = _html_to_plain_text(body_html)

        return body_text, body_html

    def _find_vault_file(self: Any, message_id: str) -> Optional[Path]:
        if not self.mail_folder:
            return None
        files = list(self.mail_folder.glob(f"{message_id}_*.md"))
        if not files:
            files = [f for f in self.mail_folder.glob("*.md") if message_id in f.stem]
        return files[0] if files else None

    def _parse_meta(self: Any, content: str) -> dict[str, Any]:
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

    def _update_vault_file(self: Any, file_path: Path, updates: dict[str, Any]) -> Any:
        content = file_path.read_text(encoding="utf-8")
        meta = self._parse_meta(content)
        body_parts = content.split("---\n", 2)
        body = body_parts[-1] if len(body_parts) >= 3 else ""
        meta.update(updates)
        new_front = yaml.dump(meta, default_flow_style=False, sort_keys=False, allow_unicode=True)
        safe_write_text(file_path, f"---\n{new_front}---\n\n{body.lstrip()}")
