"""Client de sincronització amb Drupal (JSON:API + endpoints custom `n8n_helper`).

Escriptura resistent al WAF de Pangea, que **bloqueja PATCH**:
  - CREAR node   → ``POST /jsonapi/node/<bundle>``          (JSON:API; POST no bloquejat)
  - ACTUALITZAR  → ``POST /custom/node-helper/update``       (mòdul `n8n_helper`)
  - TRADUIR      → ``POST /custom/translation-helper/add``   (mòdul `n8n_helper`)

La descoberta (tipus de contingut i camps) va per JSON:API GET. Vegeu la
directiva ``docs/dev_memory/directives/drupal_content_sync.md`` per al SOP i les
restriccions.

Credencials: ``DRUPAL_ROOT_USER`` (per defecte ``admin``) + ``DRUPAL_ROOT_PASSWORD``
(env dins Docker via ``.env_shared``; keychain ``drupal_root_password`` al host).
"""
import base64
import html as _html
import json
import logging
import os
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

JSONAPI = "application/vnd.api+json"
_TIMEOUT = httpx.Timeout(45.0, connect=15.0)


class DrupalSyncError(RuntimeError):
    """Error genèric de comunicació amb Drupal (status + cos retallat)."""


class DrupalNotFound(DrupalSyncError):
    """El node sol·licitat no existeix a Drupal (404 dels endpoints custom)."""


# --- Config / credencials --------------------------------------------------

def _base_url() -> str:
    """URL canònica de Drupal, sense ``www`` ni barra final.

    ``.env_shared`` desa ``DRUPAL_URL`` amb ``www``, però el lloc fa un 301 cap
    al host sense ``www`` i el redirect deixa caure el Basic-auth → cal atacar
    sempre el host canònic directament.
    """
    raw = (os.getenv("DRUPAL_URL") or "").strip().rstrip("/")
    if not raw:
        raise DrupalSyncError("DRUPAL_URL no configurada")
    return raw.replace("://www.", "://")


def base_url() -> str:
    """URL canònica pública de Drupal (per derivar enllaços de node)."""
    return _base_url()


def _password() -> str:
    pw = os.getenv("DRUPAL_ROOT_PASSWORD")
    if pw:
        return pw
    # Al host (fora de Docker) la contrasenya viu al keychain, com la de DeepL.
    try:
        from backend.security.keychain_manager import get_keychain

        kc = get_keychain()
        if kc.has_credential("drupal_root_password"):
            return kc.get_credential("drupal_root_password") or ""
    except Exception as exc:  # keychain no disponible (p. ex. dins Docker)
        log.warning("drupal: keychain no disponible: %s", exc)
    return ""


def _auth() -> tuple[str, str]:
    user = os.getenv("DRUPAL_ROOT_USER") or "admin"
    pw = _password()
    if not pw:
        raise DrupalSyncError(
            "DRUPAL_ROOT_PASSWORD no disponible (ni env ni keychain)"
        )
    return (user, pw)


def _client() -> httpx.AsyncClient:
    """Client httpx preconfigurat (base_url canònica, Basic-auth, timeouts)."""
    return httpx.AsyncClient(
        base_url=_base_url(),
        auth=_auth(),
        timeout=_TIMEOUT,
        follow_redirects=True,
        headers={"Accept": JSONAPI},
    )


def _raise_for(resp: httpx.Response, ctx: str) -> None:
    if resp.status_code == 404:
        raise DrupalNotFound(f"{ctx}: 404 {resp.text[:200]}")
    if resp.status_code >= 400:
        raise DrupalSyncError(f"{ctx}: {resp.status_code} {resp.text[:300]}")


def _node_url(base: str, attrs: dict) -> Optional[str]:
    """URL pública del node a partir de ``path.alias`` o, si no n'hi ha, ``/node/<nid>``."""
    alias = (attrs.get("path") or {}).get("alias")
    if alias:
        return f"{base}{alias}"
    nid = attrs.get("drupal_internal__nid")
    return f"{base}/node/{nid}" if nid else None


# --- Descoberta (lectura) --------------------------------------------------

async def list_content_types() -> list[dict]:
    """Tipus de contingut de Drupal: ``[{machine, label, uuid}]`` (ordenats per etiqueta)."""
    async with _client() as c:
        r = await c.get("/jsonapi/node_type/node_type")
    _raise_for(r, "list_content_types")
    out: list[dict] = []
    for t in r.json().get("data", []):
        a = t.get("attributes", {})
        machine = a.get("drupal_internal__type")
        if not machine:
            continue
        out.append({
            "machine": machine,
            "label": a.get("name") or machine,
            "uuid": t.get("id"),
        })
    out.sort(key=lambda x: (x["label"] or "").lower())
    return out


async def list_fields(bundle: str) -> list[dict]:
    """Camps d'un bundle: ``[{field_name, label, field_type}]``.

    Inclou el camp base ``title`` (no apareix a ``field_config``) i recorre la
    paginació per si de cas. Filtra per bundle també al client per robustesa.
    """
    fields: list[dict] = [
        {"field_name": "title", "label": "Títol", "field_type": "string"},
    ]
    seen = {"title"}
    url: Optional[str] = f"/jsonapi/field_config/field_config?filter[bundle]={bundle}"
    async with _client() as c:
        while url:
            r = await c.get(url)
            _raise_for(r, "list_fields")
            doc = r.json()
            for f in doc.get("data", []):
                a = f.get("attributes", {})
                if a.get("bundle") != bundle:
                    continue
                fn = a.get("field_name")
                if not fn or fn in seen:
                    continue
                seen.add(fn)
                # Per a camps de referència (taxonomia) capturem el/s bundle/s
                # destí (vocabularis) per poder resoldre/crear termes al sync.
                settings = a.get("settings") if isinstance(a.get("settings"), dict) else {}
                handler = settings.get("handler_settings") if isinstance(settings.get("handler_settings"), dict) else {}
                tb = handler.get("target_bundles")
                if isinstance(tb, dict):
                    target_bundles = list(tb.keys())
                elif isinstance(tb, list):
                    target_bundles = tb
                else:
                    target_bundles = []
                fields.append({
                    "field_name": fn,
                    "label": a.get("label") or fn,
                    "field_type": a.get("field_type"),
                    "target_bundles": target_bundles,
                })
            url = (doc.get("links", {}).get("next") or {}).get("href")
    return fields


def _norm_title(s) -> str:
    """Clau de comparació de títols, robusta: minúscules, sense accents, sense
    puntuació ni caràcters especials, espais col·lapsats. Perquè el match entre
    Gnosi i Drupal toleri diferències d'espais/majúscules/accents/signes."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))  # treu accents
    s = re.sub(r"[^0-9a-z\s]", " ", s.lower())  # treu puntuació/especials
    return " ".join(s.split())  # col·lapsa espais


async def find_nodes_by_title(bundle: str, title: str, limit: int = 5) -> list[dict]:
    """Nodes del bundle amb el títol EXACTE indicat: ``[{uuid, nid, url, title}]``.

    Serveix per vincular files de Gnosi a nodes de Drupal ja existents sense
    crear-ne de nous (match per títol).
    """
    title = (title or "").strip()
    if not title:
        return []
    # Match INSENSIBLE A ESPAIS: alguns nodes de Drupal tenen el títol amb espais
    # sobrants (p. ex. "…totes   "), que feien fallar el match exacte i creaven
    # duplicats. Cerquem amb CONTAINS i filtrem client-side pel títol normalitzat.
    norm = _norm_title(title)
    if not norm:
        return []
    words = re.findall(r"\w+", title, flags=re.UNICODE)
    needle = max(words, key=len) if words else title
    async with _client() as c:
        r = await c.get(
            f"/jsonapi/node/{bundle}",
            params={
                "filter[title][operator]": "CONTAINS",
                "filter[title][value]": needle,
                "page[limit]": 50,
            },
        )
    _raise_for(r, "find_nodes_by_title")
    base = _base_url()
    out: list[dict] = []
    for d in r.json().get("data", []):
        a = d.get("attributes", {})
        if _norm_title(a.get("title")) != norm:
            continue  # CONTAINS pot retornar títols més llargs: exigim match normalitzat
        out.append({
            "uuid": d.get("id"),
            "nid": a.get("drupal_internal__nid"),
            "url": _node_url(base, a),
            "title": a.get("title"),
        })
    return out


# --- Escriptura ------------------------------------------------------------

async def create_node(
    bundle: str,
    attributes: dict,
    relationships: Optional[dict] = None,
    langcode: Optional[str] = None,
) -> dict:
    """Crea un node nou via JSON:API (``POST``, no bloquejat pel WAF).

    Retorna ``{uuid, nid, url, title}``.
    """
    attrs = dict(attributes or {})
    if langcode:
        attrs.setdefault("langcode", langcode)
    payload: dict[str, Any] = {"data": {"type": f"node--{bundle}", "attributes": attrs}}
    if relationships:
        payload["data"]["relationships"] = relationships
    async with _client() as c:
        r = await c.post(
            f"/jsonapi/node/{bundle}",
            content=json.dumps(payload),
            headers={"Content-Type": JSONAPI},
        )
    _raise_for(r, "create_node")
    d = r.json().get("data", {})
    a = d.get("attributes", {})
    base = _base_url()
    return {
        "uuid": d.get("id"),
        "nid": a.get("drupal_internal__nid"),
        "url": _node_url(base, a),
        "title": a.get("title"),
    }


async def update_node(
    uuid: str,
    bundle: str,
    attributes: dict,
    relationships: Optional[dict] = None,
) -> dict:
    """Actualitza un node existent via l'endpoint custom (POST, esquiva el WAF).

    Llança ``DrupalNotFound`` si el node ja no existeix (uuid ranci) → el
    cridant pot caure a ``create_node``.
    """
    payload = {
        "uuid": uuid,
        "type": bundle,
        "attributes": attributes or {},
        "relationships": relationships or {},
    }
    async with _client() as c:
        r = await c.post(
            "/custom/node-helper/update?_format=json",
            json=payload,
            headers={"Accept": "application/json"},
        )
    _raise_for(r, "update_node")
    return r.json()


async def add_translation(uuid: str, langcode: str, fields: dict) -> dict:
    """Crea o actualitza la traducció ``langcode`` d'un node (idempotent).

    Empeny només atributs (text/cos): a Drupal els camps compartits (tags,
    imatge) no es tradueixen. Llança ``DrupalNotFound`` si el node no existeix.
    """
    payload = {"uuid": uuid, "langcode": langcode, "fields": fields or {}}
    async with _client() as c:
        r = await c.post(
            "/custom/translation-helper/add?_format=json",
            json=payload,
            headers={"Accept": "application/json"},
        )
    _raise_for(r, "add_translation")
    return r.json()


async def upload_image(
    bundle: str,
    field_name: str,
    filename: str,
    data: bytes,
) -> str:
    """Puja un fitxer binari a un camp d'imatge/fitxer i retorna l'UUID del fitxer.

    Endpoint de pujada de fitxers de JSON:API: ``POST /jsonapi/node/<bundle>/<camp>``
    amb el cos binari i ``Content-Disposition: file; filename="…"``. L'UUID
    retornat s'enllaça després com a relació ``file--file`` (amb ``meta.alt``).
    """
    headers = {
        "Accept": JSONAPI,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": f'file; filename="{filename}"',
    }
    async with _client() as c:
        r = await c.post(f"/jsonapi/node/{bundle}/{field_name}", content=data, headers=headers)
    _raise_for(r, "upload_image")
    fid = r.json().get("data", {}).get("id")
    if not fid:
        raise DrupalSyncError(f"upload_image: resposta sense UUID de fitxer ({r.text[:200]})")
    return fid


async def resolve_or_create_term(
    vocabulary: str,
    name: str,
    *,
    cache: Optional[dict] = None,
) -> str:
    """UUID del terme de taxonomia ``name`` dins ``vocabulary``; el crea si falta.

    ``cache`` (opcional) evita repetir cerques/creacions dins una mateixa execució.
    """
    name = (name or "").strip()
    if not name:
        raise DrupalSyncError("resolve_or_create_term: nom de terme buit")
    if cache is not None and name in cache:
        return cache[name]
    async with _client() as c:
        r = await c.get(
            f"/jsonapi/taxonomy_term/{vocabulary}",
            params={"filter[name]": name, "page[limit]": 1},
        )
        _raise_for(r, "resolve_term:get")
        rows = r.json().get("data", [])
        if rows:
            tid = rows[0].get("id")
        else:
            body = {"data": {"type": f"taxonomy_term--{vocabulary}", "attributes": {"name": name}}}
            rc = await c.post(
                f"/jsonapi/taxonomy_term/{vocabulary}",
                content=json.dumps(body),
                headers={"Content-Type": JSONAPI},
            )
            _raise_for(rc, "resolve_term:create")
            tid = rc.json().get("data", {}).get("id")
    if not tid:
        raise DrupalSyncError(f"resolve_or_create_term: sense UUID per «{name}»")
    if cache is not None:
        cache[name] = tid
    return tid


# --- Conversió de cos ------------------------------------------------------

def markdown_to_full_html(md: str) -> str:
    """Converteix Markdown→HTML per al camp ``body`` (format ``full_html``).

    Reutilitza ``pandoc`` (ja present a la imatge del backend), igual que la
    bibliografia de cites. És **bloquejant** (subprocess): els cridants async
    l'han d'embolcallar amb ``asyncio.to_thread``. Si pandoc falla o no hi és,
    degrada a text pla embolcallat en ``<p>``.
    """
    text = (md or "").strip()
    if not text:
        return ""
    try:
        with tempfile.TemporaryDirectory(prefix="gnosi_drupal_") as tmpdir:
            tmp = Path(tmpdir)
            (tmp / "in.md").write_text(text, encoding="utf-8")
            r = subprocess.run(
                # markdown-smart: NO transforma cometes/guions (respecta el text
                # de l'autor). shift-heading-level-by=1: el títol del node ja és
                # l'<h1>, així els títols del cos baixen un nivell (cap <h1>
                # duplicat). Els blocs `::: nom … :::` → <div class="nom">.
                ["pandoc", "in.md", "-f", "markdown-smart", "-t", "html",
                 "--wrap=none", "--shift-heading-level-by=1"],
                cwd=tmp, capture_output=True, text=True, timeout=30,
            )
            if r.returncode == 0:
                return r.stdout.strip()
            log.warning("drupal: pandoc returncode=%s stderr=%s", r.returncode, r.stderr[:200])
    except FileNotFoundError:
        log.warning("drupal: pandoc no disponible, degradant a text pla")
    except Exception as exc:
        log.warning("drupal: error convertint amb pandoc: %s", exc)
    escaped = _html.escape(text)
    return "<p>" + escaped.replace("\n\n", "</p><p>").replace("\n", "<br>\n") + "</p>"
