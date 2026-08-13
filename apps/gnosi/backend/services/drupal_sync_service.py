"""Drupal sync client (JSON:API + custom `n8n_helper` endpoints).

Writes resilient to the Pangea WAF, which **blocks PATCH**:
  - CREATE node  → ``POST /jsonapi/node/<bundle>``          (JSON:API; POST not blocked)
  - UPDATE       → ``POST /custom/node-helper/update``       (`n8n_helper` module)
  - TRANSLATE    → ``POST /custom/translation-helper/add``   (`n8n_helper` module)

Discovery (content types and fields) goes through JSON:API GET. See the
``docs/dev_memory/directives/drupal_content_sync.md`` directive for the SOP and
restrictions.

Credentials: ``DRUPAL_ROOT_USER`` (default ``admin``) + ``DRUPAL_ROOT_PASSWORD``
(env inside Docker via ``.env_shared``; ``drupal_root_password`` keychain entry on the host).
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
    """Generic Drupal communication error (status + truncated body)."""


class DrupalNotFound(DrupalSyncError):
    """The requested node does not exist in Drupal (404 from the custom endpoints)."""


# --- Config / credentials --------------------------------------------------

def _base_url() -> str:
    """Canonical Drupal URL, without ``www`` or a trailing slash.

    ``.env_shared`` stores ``DRUPAL_URL`` with ``www``, but the site issues a 301
    to the host without ``www``, and the redirect drops the Basic auth → we must always
    hit the canonical host directly.
    
    """
    raw = (os.getenv("DRUPAL_URL") or "").strip().rstrip("/")
    if not raw:
        raise DrupalSyncError("DRUPAL_URL no configurada")
    return raw.replace("://www.", "://")


def base_url() -> str:
    """Public canonical Drupal URL (used to derive node links)."""
    return _base_url()


def _password() -> str:
    pw = os.getenv("DRUPAL_ROOT_PASSWORD")
    if pw:
        return pw
    # On the host (outside Docker) the password lives in the keychain, like the DeepL one.
    try:
        from backend.security.keychain_manager import get_keychain

        kc = get_keychain()
        if kc.has_credential("drupal_root_password"):
            return kc.get_credential("drupal_root_password") or ""
    except Exception as exc:  # keychain not available (e.g. inside Docker)
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
    """Preconfigured httpx client (canonical base_url, Basic auth, timeouts)."""
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
    """Public node URL derived from ``path.alias`` or, if there isn't one, ``/node/<nid>``."""
    alias = (attrs.get("path") or {}).get("alias")
    if alias:
        return f"{base}{alias}"
    nid = attrs.get("drupal_internal__nid")
    return f"{base}/node/{nid}" if nid else None


# --- Descoberta (lectura) --------------------------------------------------

async def list_content_types() -> list[dict]:
    """Drupal content types: ``[{machine, label, uuid}]`` (sorted by label)."""
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


def _label_from_machine(name: str) -> str:
    """Readable label derived from a field's machine name (``field_editorial`` →
    ``Editorial``). Fallback for when we don't have the real ``label`` from ``field_config``."""
    base = re.sub(r"^field_", "", name or "").replace("_", " ").strip()
    return (base[:1].upper() + base[1:]) if base else (name or "")


async def list_fields(bundle: str) -> list[dict]:
    """Fields of a bundle: ``[{field_name, label, field_type}]``.

    Includes the base ``title`` field (doesn't appear in ``field_config``) and walks
    the pagination just in case. Also filters by bundle on the client side for robustness.

    Fallback: if the site's JSON:API doesn't expose the ``field_config`` config
    entity (some instances don't → 0 fields), we discover the
    fields by reading a real node from the bundle (the ``field_*`` attributes and
    relationships). We lose the exact ``field_type``/``label`` (we infer them),
    but it allows viewing and editing the mapping in the UI.
    
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
                # For reference fields (taxonomy) we capture the target bundle(s)
                # (vocabularies) so we can resolve/create terms during sync.
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

        # Fallback via real nodes when `field_config` hasn't exposed any field.
        # We request several nodes (not just one): the target bundle/vocabulary of a
        # reference field can only be inferred from a node that HAS the field
        # filled in, and a single node can have it empty (the case of `field_tags`).
        if len(fields) == 1:  # just the base `title`
            try:
                rn = await c.get(f"/jsonapi/node/{bundle}?page[limit]=50")
                if rn.status_code < 400:
                    nodes = (rn.json() or {}).get("data") or []
                    # Accumulates the target bundles for each reference field from
                    # ALL the nodes that have it populated.
                    ref_targets: dict = {}
                    for n in nodes:
                        for k, rel in (n.get("relationships") or {}).items():
                            if not k.startswith("field_"):
                                continue
                            rd = (rel or {}).get("data")
                            items = rd if isinstance(rd, list) else ([rd] if rd else [])
                            for it in items:
                                t = (it or {}).get("type") or ""  # "taxonomy_term--<vocab>"
                                if "--" in t:
                                    ref_targets.setdefault(k, set()).add(t.split("--", 1)[1])
                    # The first node already exposes ALL the bundle's fields (although
                    # empty): we use it for the list of names.
                    base = nodes[0] if nodes else {}
                    attrs = base.get("attributes") or {}
                    rels = base.get("relationships") or {}
                    if "body" in attrs and "body" not in seen:
                        seen.add("body")
                        fields.append({"field_name": "body", "label": "Body",
                                       "field_type": "text_with_summary", "target_bundles": []})
                    for k in attrs:
                        if k.startswith("field_") and k not in seen:
                            seen.add(k)
                            fields.append({"field_name": k, "label": _label_from_machine(k),
                                           "field_type": "string", "target_bundles": []})
                    for k in rels:
                        if not k.startswith("field_") or k in seen:
                            continue
                        seen.add(k)
                        fields.append({"field_name": k, "label": _label_from_machine(k),
                                       "field_type": "entity_reference",
                                       "target_bundles": sorted(ref_targets.get(k, set()))})
            except Exception as exc:  # best effort: if it fails, we fall back to `title`
                log.warning("drupal: fallback de descoberta via node per %r ha fallat: %s", bundle, exc)
    return fields


def _norm_title(s) -> str:
    """Robust title-comparison key: lowercase, no accents, no
    punctuation or special characters, collapsed spaces. So that matching between
    Gnosi and Drupal tolerates differences in spacing/case/accents/punctuation."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))  # strips accents
    s = re.sub(r"[^0-9a-z\s]", " ", s.lower())  # strips punctuation/special characters
    return " ".join(s.split())  # col·lapsa espais


async def find_nodes_by_title(bundle: str, title: str, limit: int = 5) -> list[dict]:
    """Bundle nodes with the EXACT title given: ``[{uuid, nid, url, title}]``.

    Used to link Gnosi rows to existing Drupal nodes without
    creating new ones (match by title).
    
    """
    title = (title or "").strip()
    if not title:
        return []
    # SPACE-INSENSITIVE match: some Drupal nodes have titles with duplicated
    # extra (e.g. "…totes   "), which made the exact match fail and created
    # spaces. We search with CONTAINS and filter client-side by normalized title.
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
            continue  # CONTAINS can return longer titles: we require a normalized match
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
    """Creates a new node via JSON:API (``POST``, not blocked by the WAF).

    Returns ``{uuid, nid, url, title}``.
    
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
    """Updates an existing node via the custom endpoint (POST, bypasses the WAF).

    Raises ``DrupalNotFound`` if the node no longer exists (stale uuid) → the
    caller can fall back to ``create_node``.
    
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
    """Creates or updates the ``langcode`` translation of a node (idempotent).

    Pushes only attributes (text/body): in Drupal, shared fields (tags,
    image) aren't translated. Raises ``DrupalNotFound`` if the node doesn't exist.
    
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
    """Uploads a binary file to an image/file field and returns the file's UUID.

    JSON:API file-upload endpoint: ``POST /jsonapi/node/<bundle>/<camp>``
    with the binary body and ``Content-Disposition: file; filename="…"``. The
    returned UUID is then linked as a ``file--file`` relationship (with ``meta.alt``).
    
    """
    # The Content-Disposition header must be ASCII. Library names tend to
    # may carry accents (often as macOS NFD combining characters, e.g.
    # "García"); we transliterate to ASCII for the upload name (the binary content and
    # the field's ``alt`` preserve the original text intact).
    ascii_name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode("ascii") or "file"
    headers = {
        "Accept": JSONAPI,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": f'file; filename="{ascii_name}"',
    }
    async with _client() as c:
        r = await c.post(f"/jsonapi/node/{bundle}/{field_name}", content=data, headers=headers)
    _raise_for(r, "upload_image")
    fid = r.json().get("data", {}).get("id")
    if not fid:
        raise DrupalSyncError(f"upload_image: response has no file UUID ({r.text[:200]})")
    return fid


async def find_existing_file(filename: str, filesize: Optional[int] = None) -> Optional[str]:
    """UUID of a file already uploaded to Drupal with the same name (and size), to
    reuse it instead of creating a new copy on every re-sync.

    Drupal does NOT overwrite when it receives a repeated name: it creates ``nom_0``, ``nom_1``… and
    this was bloating ``sites/default/files`` with hundreds of copies of the same
    image. The entity keeps the ORIGINAL name in ``filename`` (the collision
    suffix only goes into the ``uri``), so we filter by the EXACT upload name and,
    if ``filesize`` is passed, we validate the size in bytes so we don't reuse a
    version with different content. Returns the oldest matching file (UUID),
    or ``None`` (in which case the caller uploads, as before — no regression).
    
    """
    if not filename:
        return None
    ascii_name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode("ascii") or "file"
    try:
        async with _client() as c:
            r = await c.get(
                "/jsonapi/file/file",
                params={
                    "filter[filename]": ascii_name,
                    # Only PERMANENT files: a temporary one could be deleted by the
                    # Drupal's garbage collector and leave the node with a broken image.
                    "filter[status]": "1",
                    "fields[file--file]": "filename,filesize",
                    "sort": "drupal_internal__fid",
                    "page[limit]": 50,
                },
            )
        if r.status_code >= 400:
            log.warning("drupal: find_existing_file HTTP %s per «%s»", r.status_code, ascii_name)
            return None
        for row in (r.json() or {}).get("data", []):
            if filesize is None or (row.get("attributes") or {}).get("filesize") == filesize:
                return row.get("id")
    except Exception as exc:
        log.warning("drupal: find_existing_file ha fallat (%s): %s", filename, exc)
    return None


async def resolve_or_create_term(
    vocabulary: str,
    name: str,
    *,
    cache: Optional[dict] = None,
) -> str:
    """UUID of the taxonomy term ``name`` within ``vocabulary``; creates it if missing.

    ``cache`` (optional) avoids repeating searches/creations within the same run.
    
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


# --- Body conversion ------------------------------------------------------

def markdown_to_full_html(md: str) -> str:
    """Converts Markdown→HTML for the ``body`` field (``full_html`` format).

    Reuses ``pandoc`` (already present in the backend image), same as the
    citation bibliography. It is **blocking** (subprocess): async callers
    must wrap it with ``asyncio.to_thread``. If pandoc fails or isn't present,
    it degrades to plain text wrapped in ``<p>``.
    
    """
    text = (md or "").strip()
    if not text:
        return ""
    try:
        with tempfile.TemporaryDirectory(prefix="gnosi_drupal_") as tmpdir:
            tmp = Path(tmpdir)
            (tmp / "in.md").write_text(text, encoding="utf-8")
            r = subprocess.run(
                # markdown-smart: does NOT transform quotes/dashes (respects the text
                # of the author). shift-heading-level-by=1: the node's title is already
                # the <h1>, so the body's headings drop one level (no <h1>
                # duplicate). The `::: nom … :::` blocks → <div class="nom">.
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
