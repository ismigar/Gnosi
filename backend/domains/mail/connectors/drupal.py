"""Drupal sync client (JSON:API + custom `n8n_helper` endpoints).

Writes resilient to the Pangea WAF, which **blocks PATCH**:
  - CREATE node  → ``POST /jsonapi/node/<bundle>``          (JSON:API; POST not blocked)
  - UPDATE       → ``POST /custom/node-helper/update``       (`n8n_helper` module)
  - TRANSLATE    → ``POST /custom/translation-helper/add``   (`n8n_helper` module)

Discovery (content types and fields) goes through JSON:API GET. See the
``docs/dev_memory/directives/drupal_content_sync.md`` directive for the SOP and
restrictions.

Credentials: ``DRUPAL_ROOT_USER`` (default ``admin``) + ``DRUPAL_ROOT_PASSWORD``
(process environment inside Docker; ``drupal_root_password`` secure-store entry on the host).
"""

import html as _html
import json
import logging
import os
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from typing import Optional

import httpx

from backend.domains.mail.connectors._drupal_values import (
    copy_attributes,
    get_default,
    method_value,
    sort_rows,
    sorted_values,
    unpack_pair,
)
from backend.utils.open_values import contains_value, get_value, item_value, iterable_values

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

    The configured ``DRUPAL_URL`` may contain ``www``, while the site issues a 301
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
        raise DrupalSyncError("DRUPAL_ROOT_PASSWORD no disponible (ni env ni keychain)")
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


def _node_url(base: str, attrs: object) -> Optional[str]:
    """Public node URL derived from ``path.alias`` or, if there isn't one, ``/node/<nid>``."""
    alias = get_value(get_value(attrs, "path") or {}, "alias")
    if alias:
        return f"{base}{alias}"
    nid = get_value(attrs, "drupal_internal__nid")
    return f"{base}/node/{nid}" if nid else None


# --- Descoberta (lectura) --------------------------------------------------


async def list_content_types() -> list[dict[str, object]]:
    """Drupal content types: ``[{machine, label, uuid}]`` (sorted by label)."""
    async with _client() as c:
        r = await c.get("/jsonapi/node_type/node_type")
    _raise_for(r, "list_content_types")
    out: list[dict[str, object]] = []
    document: object = r.json()
    for t in iterable_values(get_default(document, "data", [])):
        a = get_default(t, "attributes", {})
        machine = get_value(a, "drupal_internal__type")
        if not machine:
            continue
        out.append(
            {
                "machine": machine,
                "label": get_value(a, "name") or machine,
                "uuid": get_value(t, "id"),
            }
        )
    sort_rows(out, key=lambda x: method_value(x["label"] or "", "lower"))
    return out


def _label_from_machine(name: object) -> object:
    """Readable label derived from a field's machine name (``field_editorial`` →
    ``Editorial``). Fallback for when we don't have the real ``label`` from ``field_config``."""
    # re owns input validation. Do not use an arg-type exception here: object
    # fails overload selection (call-overload); narrowing it would change errors.
    base = re.sub(r"^field_", "", name or "").replace("_", " ").strip()  # type: ignore[call-overload]
    return (base[:1].upper() + base[1:]) if base else (name or "")


def _target_bundles(attributes: object) -> list[object]:
    settings = get_value(attributes, "settings")
    settings = settings if isinstance(settings, dict) else {}
    handler: object = settings.get("handler_settings")
    handler = handler if isinstance(handler, dict) else {}
    bundles: object = handler.get("target_bundles")
    if isinstance(bundles, dict):
        return list(bundles)
    return bundles if isinstance(bundles, list) else []


def _append_config_fields(
    fields: list[dict[str, object]], seen: set[object], document: object, bundle: str
) -> None:
    for item in iterable_values(get_default(document, "data", [])):
        attributes = get_default(item, "attributes", {})
        field_name = get_value(attributes, "field_name")
        if get_value(attributes, "bundle") != bundle or not field_name or field_name in seen:
            continue
        seen.add(field_name)
        fields.append(
            {
                "field_name": field_name,
                "label": get_value(attributes, "label") or field_name,
                "field_type": get_value(attributes, "field_type"),
                "target_bundles": _target_bundles(attributes),
            }
        )


def _reference_targets(nodes: object) -> dict[object, set[object]]:
    targets: dict[object, set[object]] = {}
    for node in iterable_values(nodes):
        for pair in iterable_values(method_value(get_value(node, "relationships") or {}, "items")):
            field_name, relation = unpack_pair(pair)
            if not method_value(field_name, "startswith", "field_"):
                continue
            data = get_value(relation or {}, "data")
            items: list[object] = data if isinstance(data, list) else ([data] if data else [])
            for item in items:
                resource_type = get_value(item or {}, "type") or ""
                if contains_value(resource_type, "--"):
                    targets.setdefault(field_name, set()).add(
                        item_value(method_value(resource_type, "split", "--", 1), 1)
                    )
    return targets


def _append_inferred_fields(
    fields: list[dict[str, object]], seen: set[object], nodes: object
) -> None:
    base = item_value(nodes, 0) if nodes else {}
    attributes = get_value(base, "attributes") or {}
    relationships = get_value(base, "relationships") or {}
    targets = _reference_targets(nodes)
    if contains_value(attributes, "body") and "body" not in seen:
        seen.add("body")
        fields.append(
            {
                "field_name": "body",
                "label": "Body",
                "field_type": "text_with_summary",
                "target_bundles": [],
            }
        )
    for field_name in iterable_values(attributes):
        if method_value(field_name, "startswith", "field_") and field_name not in seen:
            seen.add(field_name)
            fields.append(
                {
                    "field_name": field_name,
                    "label": _label_from_machine(field_name),
                    "field_type": "string",
                    "target_bundles": [],
                }
            )
    for field_name in iterable_values(relationships):
        if not method_value(field_name, "startswith", "field_") or field_name in seen:
            continue
        seen.add(field_name)
        fields.append(
            {
                "field_name": field_name,
                "label": _label_from_machine(field_name),
                "field_type": "entity_reference",
                "target_bundles": sorted_values(targets.get(field_name, set())),
            }
        )


async def list_fields(bundle: str) -> list[dict[str, object]]:
    """Fields of a bundle: ``[{field_name, label, field_type}]``.

    Includes the base ``title`` field (doesn't appear in ``field_config``) and walks
    the pagination just in case. Also filters by bundle on the client side for robustness.

    Fallback: if the site's JSON:API doesn't expose the ``field_config`` config
    entity (some instances don't → 0 fields), we discover the
    fields by reading a real node from the bundle (the ``field_*`` attributes and
    relationships). We lose the exact ``field_type``/``label`` (we infer them),
    but it allows viewing and editing the mapping in the UI.

    """
    fields: list[dict[str, object]] = [
        {"field_name": "title", "label": "Títol", "field_type": "string"},
    ]
    seen: set[object] = {"title"}
    url: object = f"/jsonapi/field_config/field_config?filter[bundle]={bundle}"
    async with _client() as c:
        while url:
            # HTTPX owns URL validation; preserve opaque href and native failures.
            r = await c.get(url)  # type: ignore[arg-type]
            _raise_for(r, "list_fields")
            doc: object = r.json()
            _append_config_fields(fields, seen, doc, bundle)
            url = get_value(get_value(get_default(doc, "links", {}), "next") or {}, "href")

        # Fallback via real nodes when `field_config` hasn't exposed any field.
        # We request several nodes (not just one): the target bundle/vocabulary of a
        # reference field can only be inferred from a node that HAS the field
        # filled in, and a single node can have it empty (the case of `field_tags`).
        if len(fields) == 1:  # just the base `title`
            try:
                rn = await c.get(f"/jsonapi/node/{bundle}?page[limit]=50")
                if rn.status_code < 400:
                    node_document: object = rn.json()
                    nodes = get_value(node_document or {}, "data") or []
                    _append_inferred_fields(fields, seen, nodes)
            except Exception as exc:  # best effort: if it fails, we fall back to `title`
                log.warning(
                    "drupal: fallback de descoberta via node per %r ha fallat: %s", bundle, exc
                )
    return fields


def _norm_title(s: object) -> str:
    """Robust title-comparison key: lowercase, no accents, no
    punctuation or special characters, collapsed spaces. So that matching between
    Gnosi and Drupal tolerates differences in spacing/case/accents/punctuation."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))  # strips accents
    s = re.sub(r"[^0-9a-z\s]", " ", s.lower())  # strips punctuation/special characters
    return " ".join(s.split())  # col·lapsa espais


async def find_nodes_by_title(bundle: str, title: str, limit: int = 5) -> list[dict[str, object]]:
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
    out: list[dict[str, object]] = []
    document: object = r.json()
    for d in iterable_values(get_default(document, "data", [])):
        a = get_default(d, "attributes", {})
        if _norm_title(get_value(a, "title")) != norm:
            continue  # CONTAINS can return longer titles: we require a normalized match
        out.append(
            {
                "uuid": get_value(d, "id"),
                "nid": get_value(a, "drupal_internal__nid"),
                "url": _node_url(base, a),
                "title": get_value(a, "title"),
            }
        )
    return out


# --- Escriptura ------------------------------------------------------------


async def create_node(
    bundle: str,
    attributes: object,
    relationships: object = None,
    langcode: object = None,
) -> dict[str, object]:
    """Creates a new node via JSON:API (``POST``, not blocked by the WAF).

    Returns ``{uuid, nid, url, title}``.

    """
    attrs = copy_attributes(attributes or {})
    if langcode:
        attrs.setdefault("langcode", langcode)
    data: dict[str, object] = {"type": f"node--{bundle}", "attributes": attrs}
    payload: dict[str, object] = {"data": data}
    if relationships:
        data["relationships"] = relationships
    async with _client() as c:
        r = await c.post(
            f"/jsonapi/node/{bundle}",
            content=json.dumps(payload),
            headers={"Content-Type": JSONAPI},
        )
    _raise_for(r, "create_node")
    document: object = r.json()
    d = get_default(document, "data", {})
    a = get_default(d, "attributes", {})
    base = _base_url()
    return {
        "uuid": get_value(d, "id"),
        "nid": get_value(a, "drupal_internal__nid"),
        "url": _node_url(base, a),
        "title": get_value(a, "title"),
    }


async def update_node(
    uuid: object,
    bundle: str,
    attributes: object,
    relationships: object = None,
) -> object:
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
    result: object = r.json()
    return result


async def add_translation(uuid: object, langcode: object, fields: object) -> object:
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
    result: object = r.json()
    return result


async def upload_image(
    bundle: str,
    field_name: object,
    filename: str,
    data: bytes,
) -> object:
    """Uploads a binary file to an image/file field and returns the file's UUID.

    JSON:API file-upload endpoint: ``POST /jsonapi/node/<bundle>/<camp>``
    with the binary body and ``Content-Disposition: file; filename="…"``. The
    returned UUID is then linked as a ``file--file`` relationship (with ``meta.alt``).

    """
    # The Content-Disposition header must be ASCII. Library names tend to
    # may carry accents (often as macOS NFD combining characters, e.g.
    # "García"); we transliterate to ASCII for the upload name (the binary content and
    # the field's ``alt`` preserve the original text intact).
    ascii_name = (
        unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode("ascii") or "file"
    )
    headers = {
        "Accept": JSONAPI,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": f'file; filename="{ascii_name}"',
    }
    async with _client() as c:
        r = await c.post(f"/jsonapi/node/{bundle}/{field_name}", content=data, headers=headers)
    _raise_for(r, "upload_image")
    document: object = r.json()
    fid = get_value(get_default(document, "data", {}), "id")
    if not fid:
        raise DrupalSyncError(f"upload_image: response has no file UUID ({r.text[:200]})")
    return fid


async def find_existing_file(filename: str, filesize: Optional[int] | None = None) -> object:
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
    ascii_name = (
        unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode("ascii") or "file"
    )
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
        document: object = r.json()
        for row in iterable_values(get_default(document or {}, "data", [])):
            if (
                filesize is None
                or get_value(get_value(row, "attributes") or {}, "filesize") == filesize
            ):
                return get_value(row, "id")
    except Exception as exc:
        log.warning("drupal: find_existing_file ha fallat (%s): %s", filename, exc)
    return None


async def resolve_or_create_term(
    vocabulary: object,
    name: str,
    *,
    cache: dict[str, object] | None = None,
) -> object:
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
        document: object = r.json()
        rows = get_default(document, "data", [])
        if rows:
            tid = get_value(item_value(rows, 0), "id")
        else:
            body = {"data": {"type": f"taxonomy_term--{vocabulary}", "attributes": {"name": name}}}
            rc = await c.post(
                f"/jsonapi/taxonomy_term/{vocabulary}",
                content=json.dumps(body),
                headers={"Content-Type": JSONAPI},
            )
            _raise_for(rc, "resolve_term:create")
            created_document: object = rc.json()
            tid = get_value(get_default(created_document, "data", {}), "id")
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
                [
                    "pandoc",
                    "in.md",
                    "-f",
                    "markdown-smart",
                    "-t",
                    "html",
                    "--wrap=none",
                    "--shift-heading-level-by=1",
                ],
                cwd=tmp,
                capture_output=True,
                text=True,
                timeout=30,
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
