"""Converteix imatges del vault referenciades al cos d'un correu en adjunts
inline amb Content-ID, i construeix l'arbre MIME compartit pels enviadors.

El compositor (BlockNote) insereix les imatges enganxades com a
``<img src="/api/vault/assets/...">``. Aquesta URL només resol dins del Gnosi
local: si s'envia tal qual, el destinatari rep la imatge trencada. Just abans
d'enviar, ``extract_vault_inline_images`` substitueix cada ``src`` per
``cid:<id>`` i retorna els bytes perquè viatgin com a part ``multipart/related``
del missatge (els data-URI es descarten: Gmail/Outlook els eliminen del cos).
"""
import email as email_lib
import html
import logging
import mimetypes
import re
import urllib.parse
import uuid
from email import encoders
from email.header import decode_header, make_header
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from backend.services.context_vars import get_active_vault_path

log = logging.getLogger(__name__)

# Atribut src amb URL (relativa o absoluta amb host) cap a /api/vault/assets/.
# Només `src=`: els enllaços <a href> a fitxers del vault no són imatges inline.
_VAULT_ASSET_SRC_RE = re.compile(
    r"""src=(["'])(?P<url>(?:https?://[^"']*?)?/api/vault/assets/[^"']+)\1""",
    re.IGNORECASE,
)

# Atribut src que apunta a un Content-ID: el quotedHtml d'un reply/forward
# conserva els cid: del missatge original (sense part MIME al correu nou).
_CID_SRC_RE = re.compile(
    r"""src=(["'])cid:(?P<cid>[^"']+)\1""",
    re.IGNORECASE,
)

# Atribut src cap a l'endpoint /api/mail/messages/{id}/cid/{cid}: és com el
# viewer (i el quotedHtml) referencien les imatges inline d'un missatge rebut
# perquè el composer les mostri. La URL és autocontinguda (missatge, cid,
# email i folder al query) — en enviar es torna part inline pròpia.
_MAIL_CID_SRC_RE = re.compile(
    r"""src=(["'])(?P<url>(?:https?://[^"']*?)?/api/mail/messages/[^/"']+/cid/[^"']+)\1""",
    re.IGNORECASE,
)


def new_content_id() -> str:
    """Content-ID únic per a una part inline generada per Gnosi."""
    return f"{uuid.uuid4().hex}@gnosi.local"


def _resolve_asset_file(url: str, assets_root: Path) -> Path | None:
    """Resol la URL d'un asset al fitxer dins d'``Assets/`` del vault actiu.

    Retorna None si el path escapa d'Assets (traversal) o no és un fitxer.
    """
    rel = url.split("/api/vault/assets/", 1)[1]
    # L'HTML serialitza & com &amp; i els noms amb espais van percent-encoded.
    rel = urllib.parse.unquote(html.unescape(rel))
    rel = rel.split("?", 1)[0].split("#", 1)[0]
    if not rel:
        return None
    candidate = (assets_root / rel).resolve()
    if not candidate.is_relative_to(assets_root):
        log.warning("Asset fora d'Assets/ ignorat per inline: %r", url)
        return None
    if not candidate.is_file():
        return None
    return candidate


def extract_vault_inline_images(body: str) -> tuple[str, list[dict]]:
    """Substitueix els src d'assets del vault per cid: i en retorna els bytes.

    Args:
        body: HTML del cos del correu tal com surt del compositor.

    Returns:
        Tupla (cos_nou, inline_images) on inline_images és una llista de dicts
        amb filename, content_type, data i content_id. La mateixa URL repetida
        reutilitza el mateix Content-ID. Si un asset no existeix, no és una
        imatge o no es pot llegir, la seva URL es deixa intacta (mai es bloqueja
        l'enviament per un asset perdut).
    """
    if not body or "/api/vault/assets/" not in body:
        return body, []

    try:
        assets_root = (get_active_vault_path() / "Assets").resolve()
    except Exception as e:
        log.warning("No s'ha pogut resoldre Assets/ del vault actiu: %s", e)
        return body, []

    images: list[dict] = []
    cid_by_url: dict[str, str | None] = {}

    def _replace(match: re.Match) -> str:
        url = match.group("url")
        if url not in cid_by_url:
            cid_by_url[url] = None
            asset = _resolve_asset_file(url, assets_root)
            if asset is None:
                log.warning("Imatge inline no trobada al vault, es deixa la URL: %r", url)
            else:
                content_type = mimetypes.guess_type(asset.name)[0] or ""
                data = asset.read_bytes()
                if not content_type.startswith("image/"):
                    log.warning("src d'asset no-imatge (%s), es deixa la URL: %r", content_type, url)
                elif not data:
                    # 0 bytes = probable fitxer OneDrive online-only no materialitzat
                    log.warning("Asset buit (online-only?), es deixa la URL: %r", url)
                else:
                    cid = new_content_id()
                    images.append({
                        "filename": asset.name,
                        "content_type": content_type,
                        "data": data,
                        "content_id": cid,
                    })
                    cid_by_url[url] = cid
        cid = cid_by_url[url]
        if cid is None:
            return match.group(0)
        quote = match.group(1)
        return f"src={quote}cid:{cid}{quote}"

    new_body = _VAULT_ASSET_SRC_RE.sub(_replace, body)
    return new_body, images


def find_cid_srcs(body: str) -> set[str]:
    """Content-IDs referenciats com a ``src="cid:..."`` al cos (sense ``<>``)."""
    if not body or "cid:" not in body:
        return set()
    return {m.group("cid") for m in _CID_SRC_RE.finditer(body)}


def rewrite_cid_srcs(body: str, mapping: dict) -> str:
    """Reescriu ``src="cid:vell"`` → ``src="cid:nou"`` segons el mapping.

    Els cid sense entrada al mapping (irrecuperables) es deixen intactes:
    el destinatari els veurà trencats igual que abans, però mai es bloqueja
    l'enviament ni es perden els altres.
    """
    if not body or not mapping:
        return body

    def _replace(match: re.Match) -> str:
        new_cid = mapping.get(match.group("cid"))
        if new_cid is None:
            return match.group(0)
        quote = match.group(1)
        return f"src={quote}cid:{new_cid}{quote}"

    return _CID_SRC_RE.sub(_replace, body)


def find_mail_cid_refs(body: str) -> list[dict]:
    """Referències a ``/api/mail/messages/{id}/cid/{cid}`` als src del cos.

    Returns:
        Llista (ordre d'aparició, URLs úniques) de dicts amb ``url`` (literal
        del src, per reescriure'l), ``message_id`` i ``cid`` (percent-
        decodificats) i ``email``/``folder`` del query de la URL (None si no
        hi són).
    """
    if not body or "/api/mail/messages/" not in body:
        return []
    refs: list[dict] = []
    seen: set = set()
    for match in _MAIL_CID_SRC_RE.finditer(body):
        url = match.group("url")
        if url in seen:
            continue
        seen.add(url)
        parsed = urllib.parse.urlsplit(html.unescape(url))
        rest = parsed.path.split("/api/mail/messages/", 1)[1]
        message_id, _, cid = rest.partition("/cid/")
        if not message_id or not cid:
            continue
        query = urllib.parse.parse_qs(parsed.query)
        refs.append({
            "url": url,
            "message_id": urllib.parse.unquote(message_id),
            "cid": urllib.parse.unquote(cid),
            "email": (query.get("email") or [None])[0],
            "folder": (query.get("folder") or [None])[0],
        })
    return refs


def rewrite_mail_cid_srcs(body: str, mapping: dict) -> str:
    """Reescriu ``src="<url /cid/>"`` → ``src="cid:nou"`` (mapping per URL literal)."""
    if not body or not mapping:
        return body

    def _replace(match: re.Match) -> str:
        new_cid = mapping.get(match.group("url"))
        if new_cid is None:
            return match.group(0)
        quote = match.group(1)
        return f"src={quote}cid:{new_cid}{quote}"

    return _MAIL_CID_SRC_RE.sub(_replace, body)


def _decode_mime_words(value: str) -> str:
    """Decodifica un filename amb encoded-words RFC 2047 (=?utf-8?...?=)."""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def extract_inline_parts_from_mime(raw_bytes: bytes, wanted_cids: set) -> dict:
    """Extreu d'un missatge MIME cru les parts amb els Content-ID demanats.

    Args:
        raw_bytes: missatge RFC 822 complet (p. ex. FETCH BODY[] d'IMAP).
        wanted_cids: Content-IDs buscats (amb o sense ``<>``).

    Returns:
        Dict cid (sense ``<>``) → {filename, content_type, data}. Les parts
        sense payload descodificable s'ometen.
    """
    wanted = {c.strip("<>") for c in wanted_cids if c}
    if not wanted:
        return {}
    msg = email_lib.message_from_bytes(raw_bytes)
    parts: dict = {}
    for part in msg.walk():
        part_cid = (part.get("Content-ID") or "").strip("<>")
        if not part_cid or part_cid not in wanted or part_cid in parts:
            continue
        payload = part.get_payload(decode=True)
        if not payload:
            continue
        parts[part_cid] = {
            "filename": _decode_mime_words(part.get_filename() or "image"),
            "content_type": part.get_content_type() or "image/png",
            "data": payload,
        }
    return parts


def _file_part(content_type: str, data: bytes) -> MIMEBase:
    maintype, _, subtype = (content_type or "application/octet-stream").partition("/")
    part = MIMEBase(maintype or "application", subtype or "octet-stream")
    part.set_payload(data)
    encoders.encode_base64(part)
    return part


def build_mail_content(
    body: str,
    attachments: list | None = None,
    inline_images: list | None = None,
):
    """Construeix l'arbre MIME del contingut (sense capçaleres d'enviament).

    Estructura: text → multipart/related(text + inline) si hi ha imatges
    inline → multipart/mixed(related|text + adjunts) si hi ha adjunts. Els
    enviadors (Gmail, SMTP) hi afegeixen From/To/Subject/... a sobre.

    Args:
        body: cos del missatge (HTML si comença per "<", text pla si no).
        attachments: dicts amb filename, content_type i data.
        inline_images: dicts d'``extract_vault_inline_images``.

    Returns:
        email.message.Message arrel del contingut.
    """
    subtype = "html" if body.strip().startswith("<") else "plain"
    content = MIMEText(body, subtype, "utf-8")

    if inline_images:
        related = MIMEMultipart("related")
        related.attach(content)
        for img in inline_images:
            part = _file_part(img.get("content_type"), img["data"])
            part.add_header("Content-ID", f"<{img['content_id']}>")
            part.add_header(
                "Content-Disposition", "inline",
                filename=img.get("filename", "image"),
            )
            related.attach(part)
        content = related

    if attachments:
        mixed = MIMEMultipart("mixed")
        mixed.attach(content)
        for att in attachments:
            part = _file_part(att.get("content_type"), att["data"])
            part.add_header(
                "Content-Disposition", "attachment",
                filename=att.get("filename", "attachment"),
            )
            mixed.attach(part)
        content = mixed

    return content
