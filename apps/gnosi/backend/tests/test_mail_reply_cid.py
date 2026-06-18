"""Tests del flux «imatges citades» en respondre/reenviar correus.

El quotedHtml d'un reply/forward referencia les imatges inline del missatge
original com a URL /api/mail/messages/{id}/cid/{cid} (o cid: cru en cossos
generats fora del viewer); sense la part MIME corresponent al correu nou, el
destinatari les veia trencades.

What we cover:
    - find_cid_srcs / rewrite_cid_srcs / find_mail_cid_refs /
      rewrite_mail_cid_srcs (helpers purs sobre el cos HTML)
    - extract_inline_parts_from_mime: recuperar parts per Content-ID d'un
      missatge MIME cru (camí IMAP)
    - _embed_quoted_cid_images (mail_routes): orquestració amb el collector
      mockejat — URLs /cid/ (reply i /send), cid: crus, resolució parcial,
      original no trobat, errors de transport (mai bloquegen l'enviament)
    - microsoft_get_inline_parts: mapping d'adjunts Graph per contentId

What we deliberately do NOT cover here:
    - Enviaments reals (necessiten comptes; vegeu la directiva
      mail_inline_images_cid.md, pla de test)

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_mail_reply_cid.py -v
"""
from __future__ import annotations

import asyncio

from backend.services.mail_inline_images import (
    build_mail_content,
    extract_inline_parts_from_mime,
    find_cid_srcs,
    find_mail_cid_refs,
    rewrite_cid_srcs,
    rewrite_mail_cid_srcs,
)

# 1x1 transparent PNG
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfa\xcf"
    b"\xf0\x1f\x00\x05\x05\x02\x00_\xc8\xf1\xd2\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ── find_cid_srcs / rewrite_cid_srcs ─────────────────────────────────────────

def test_find_cid_srcs_basic_and_quotes():
    body = (
        '<img src="cid:abc@mail.example">'
        "<img src='cid:def@mail.example'>"
        '<img src="cid:abc@mail.example">'  # duplicat → un sol cid
    )
    assert find_cid_srcs(body) == {"abc@mail.example", "def@mail.example"}


def test_find_cid_srcs_ignores_href_and_plain_text():
    body = '<a href="cid:abc@x">link</a><p>parleu de cid:foo al text</p>'
    assert find_cid_srcs(body) == set()


def test_find_cid_srcs_empty_body():
    assert find_cid_srcs("") == set()
    assert find_cid_srcs("<p>res</p>") == set()


def test_rewrite_cid_srcs_maps_and_keeps_unknown():
    body = '<img src="cid:old1"><img src=\'cid:old2\'><img src="cid:old3">'
    out = rewrite_cid_srcs(body, {"old1": "new1", "old2": "new2"})
    assert 'src="cid:new1"' in out
    assert "src='cid:new2'" in out  # conserva l'estil de cometes
    assert 'src="cid:old3"' in out  # sense mapping → intacte
    assert "old1" not in out and "old2" not in out


def test_rewrite_cid_srcs_noop_without_mapping():
    body = '<img src="cid:old1">'
    assert rewrite_cid_srcs(body, {}) == body


# ── find_mail_cid_refs / rewrite_mail_cid_srcs ───────────────────────────────

QUOTED_URL = (
    "/api/mail/messages/imap_777/cid/logo123%40original.example"
    "?email=compte%40example.com&amp;folder=Clients"
)


def test_find_mail_cid_refs_parses_url_query_and_dedups():
    body = f'<p>citat</p><img src="{QUOTED_URL}"><img src="{QUOTED_URL}">'
    refs = find_mail_cid_refs(body)
    assert len(refs) == 1  # mateixa URL → una sola ref
    ref = refs[0]
    assert ref["url"] == QUOTED_URL
    assert ref["message_id"] == "imap_777"
    assert ref["cid"] == "logo123@original.example"  # percent-decodificat
    assert ref["email"] == "compte@example.com"      # &amp; → & (html unescape)
    assert ref["folder"] == "Clients"


def test_find_mail_cid_refs_absolute_and_no_query():
    body = ('<img src="https://localhost:5173/api/mail/messages/abc/cid/x%40y">'
            '<img src="/api/vault/assets/Inline/a.png">'
            '<a href="/api/mail/messages/abc/cid/z@z">no és src</a>')
    refs = find_mail_cid_refs(body)
    assert len(refs) == 1
    assert refs[0]["message_id"] == "abc"
    assert refs[0]["cid"] == "x@y"
    assert refs[0]["email"] is None
    assert refs[0]["folder"] is None


def test_find_mail_cid_refs_empty():
    assert find_mail_cid_refs("") == []
    assert find_mail_cid_refs('<img src="/api/vault/assets/x.png">') == []


def test_rewrite_mail_cid_srcs_by_literal_url():
    body = f'<img src="{QUOTED_URL}"><img src="/api/mail/messages/m2/cid/k@k">'
    out = rewrite_mail_cid_srcs(body, {QUOTED_URL: "nou@gnosi.local"})
    assert 'src="cid:nou@gnosi.local"' in out
    assert '/api/mail/messages/m2/cid/k@k' in out  # sense mapping → intacte
    assert QUOTED_URL not in out


# ── extract_inline_parts_from_mime (camí IMAP) ───────────────────────────────

def _raw_original(cids=("orig1@mx", "orig2@mx")):
    """Missatge MIME real amb una part inline per cada cid."""
    body = "".join(f'<img src="cid:{c}">' for c in cids)
    inline = [
        {"filename": f"img{i}.png", "content_type": "image/png",
         "data": PNG_BYTES + bytes([i]), "content_id": c}
        for i, c in enumerate(cids)
    ]
    return build_mail_content(body, inline_images=inline).as_bytes()


def test_extract_parts_finds_wanted_cids():
    raw = _raw_original()
    parts = extract_inline_parts_from_mime(raw, {"orig1@mx", "orig2@mx"})
    assert set(parts) == {"orig1@mx", "orig2@mx"}
    assert parts["orig1@mx"]["data"] == PNG_BYTES + b"\x00"
    assert parts["orig1@mx"]["content_type"] == "image/png"
    assert parts["orig1@mx"]["filename"] == "img0.png"


def test_extract_parts_strips_angle_brackets():
    raw = _raw_original()
    parts = extract_inline_parts_from_mime(raw, {"<orig1@mx>"})
    assert set(parts) == {"orig1@mx"}


def test_extract_parts_ignores_unwanted_and_missing():
    raw = _raw_original()
    parts = extract_inline_parts_from_mime(raw, {"orig2@mx", "no-existeix@mx"})
    assert set(parts) == {"orig2@mx"}
    assert extract_inline_parts_from_mime(raw, set()) == {}


# ── _embed_quoted_cid_images (orquestració a mail_routes) ────────────────────

def _embed(monkeypatch, body, inline_images, collected, raises=False,
           source_message_id="msg1", source_folder="Arxiu"):
    """Executa _embed_quoted_cid_images amb el collector substituït."""
    from backend.api import mail_routes

    calls = []

    async def fake_collect(email, message_id, wanted, folder="INBOX"):
        calls.append({"email": email, "message_id": message_id,
                      "wanted": set(wanted), "folder": folder})
        if raises:
            raise RuntimeError("transport caigut")
        return collected

    monkeypatch.setattr(mail_routes, "_collect_original_inline_parts", fake_collect)
    new_body = asyncio.run(mail_routes._embed_quoted_cid_images(
        "a@b.c", body, inline_images,
        source_message_id=source_message_id, source_folder=source_folder,
    ))
    return new_body, calls


def test_embed_attaches_and_rewrites(monkeypatch):
    body = '<p>resposta</p><blockquote><img src="cid:orig1@mx"></blockquote>'
    inline = []
    collected = {"orig1@mx": {"filename": "foto.png", "content_type": "image/png",
                              "data": PNG_BYTES}}
    new_body, calls = _embed(monkeypatch, body, inline, collected)

    assert len(inline) == 1
    new_cid = inline[0]["content_id"]
    assert new_cid.endswith("@gnosi.local")
    assert inline[0]["data"] == PNG_BYTES
    assert f'src="cid:{new_cid}"' in new_body
    assert "orig1@mx" not in new_body
    assert calls[0]["wanted"] == {"orig1@mx"}
    assert calls[0]["folder"] == "Arxiu"


def test_embed_api_url_uses_embedded_context(monkeypatch):
    """La URL /cid/ mana: email, missatge i folder surten del seu query."""
    body = f'<p>resposta</p><img src="{QUOTED_URL}">'
    inline = []
    collected = {"logo123@original.example": {
        "filename": "logo.png", "content_type": "image/png", "data": PNG_BYTES}}
    new_body, calls = _embed(monkeypatch, body, inline, collected)

    assert len(inline) == 1
    new_cid = inline[0]["content_id"]
    assert f'src="cid:{new_cid}"' in new_body
    assert "/api/mail/messages/" not in new_body
    # el fetch va al compte/missatge/carpeta de la URL, no als del reply
    assert calls[0]["email"] == "compte@example.com"
    assert calls[0]["message_id"] == "imap_777"
    assert calls[0]["folder"] == "Clients"
    assert calls[0]["wanted"] == {"logo123@original.example"}


def test_embed_api_url_without_source_message(monkeypatch):
    """/send (draft reprès): URLs /cid/ es resolen; cid: crus queden intactes."""
    from backend.api import mail_routes

    body = f'<img src="{QUOTED_URL}"><img src="cid:orfe@mx">'
    inline = []
    collected = {"logo123@original.example": {
        "filename": "logo.png", "content_type": "image/png", "data": PNG_BYTES}}

    calls = []

    async def fake_collect(email, message_id, wanted, folder="INBOX"):
        calls.append({"wanted": set(wanted)})
        return collected

    monkeypatch.setattr(mail_routes, "_collect_original_inline_parts", fake_collect)
    new_body = asyncio.run(mail_routes._embed_quoted_cid_images("a@b.c", body, inline))

    assert len(inline) == 1
    assert "/api/mail/messages/" not in new_body
    assert 'src="cid:orfe@mx"' in new_body  # sense missatge d'origen → intacte
    assert calls[0]["wanted"] == {"logo123@original.example"}


def test_embed_groups_api_urls_per_source_message(monkeypatch):
    """Dues imatges del mateix missatge citat → un sol fetch amb els dos cids."""
    body = ('<img src="/api/mail/messages/m9/cid/a%40x?email=c%40d.e&amp;folder=F">'
            '<img src="/api/mail/messages/m9/cid/b%40x?email=c%40d.e&amp;folder=F">')
    inline = []
    collected = {
        "a@x": {"filename": "a.png", "content_type": "image/png", "data": PNG_BYTES},
        "b@x": {"filename": "b.png", "content_type": "image/png", "data": PNG_BYTES},
    }
    new_body, calls = _embed(monkeypatch, body, inline, collected)

    assert len(calls) == 1
    assert calls[0]["wanted"] == {"a@x", "b@x"}
    assert calls[0]["message_id"] == "m9"
    assert len(inline) == 2
    assert "/api/mail/messages/" not in new_body


def test_embed_skips_own_fresh_cids(monkeypatch):
    """Els cid acabats de generar per extract_vault_inline_images no es refetchen."""
    body = '<img src="cid:nou@gnosi.local">'
    inline = [{"filename": "x.png", "content_type": "image/png",
               "data": PNG_BYTES, "content_id": "nou@gnosi.local"}]
    new_body, calls = _embed(monkeypatch, body, inline, {})
    assert new_body == body
    assert calls == []  # cap residual → no es crida el collector
    assert len(inline) == 1


def test_embed_partial_resolution(monkeypatch):
    body = '<img src="cid:orig1@mx"><img src="cid:perdut@mx">'
    inline = []
    collected = {"orig1@mx": {"filename": "a.png", "content_type": "image/png",
                              "data": PNG_BYTES}}
    new_body, _ = _embed(monkeypatch, body, inline, collected)
    assert len(inline) == 1
    assert 'src="cid:perdut@mx"' in new_body  # irrecuperable → intacte
    assert "orig1@mx" not in new_body


def test_embed_message_not_found_keeps_body(monkeypatch):
    body = '<img src="cid:orig1@mx">'
    inline = []
    new_body, _ = _embed(monkeypatch, body, inline, None)
    assert new_body == body
    assert inline == []


def test_embed_transport_error_keeps_body(monkeypatch):
    body = '<img src="cid:orig1@mx">'
    inline = []
    new_body, _ = _embed(monkeypatch, body, inline, {}, raises=True)
    assert new_body == body
    assert inline == []


def test_embed_end_to_end_mime(monkeypatch):
    """Reply complet: cos amb cid citat → MIME amb cada cid: amb la seva part."""
    import re

    body = '<p>gràcies!</p><blockquote><img src="cid:orig1@mx"></blockquote>'
    inline = []
    collected = {"orig1@mx": {"filename": "foto.png", "content_type": "image/png",
                              "data": PNG_BYTES}}
    new_body, _ = _embed(monkeypatch, body, inline, collected)
    msg = build_mail_content(new_body, inline_images=inline)

    body_cids = set(re.findall(r'cid:([^"\']+)', new_body))
    part_cids = {p["Content-ID"].strip("<>") for p in msg.walk() if p["Content-ID"]}
    assert body_cids == part_cids != set()


# ── microsoft_get_inline_parts ───────────────────────────────────────────────

def test_microsoft_inline_parts_filters_and_decodes(monkeypatch):
    import base64

    from backend.services import microsoft_mail_service as ms

    payload = {"value": [
        {"contentId": "<orig1@mx>", "name": "foto.png", "contentType": "image/png",
         "contentBytes": base64.b64encode(PNG_BYTES).decode()},
        {"contentId": "altre@mx", "name": "x.png", "contentType": "image/png",
         "contentBytes": base64.b64encode(b"zz").decode()},
        {"name": "sense-cid.pdf", "contentType": "application/pdf",
         "contentBytes": base64.b64encode(b"pdf").decode()},
        {"contentId": "ref@mx", "name": "referenceAttachment"},  # sense contentBytes
    ]}
    monkeypatch.setattr(ms, "_authed_get", lambda email, path, **kw: payload)

    parts = ms.microsoft_get_inline_parts("a@b.c", "m1", {"orig1@mx", "ref@mx"})
    assert set(parts) == {"orig1@mx"}
    assert parts["orig1@mx"]["data"] == PNG_BYTES
    assert parts["orig1@mx"]["filename"] == "foto.png"


def test_microsoft_inline_parts_unreachable(monkeypatch):
    from backend.services import microsoft_mail_service as ms

    monkeypatch.setattr(ms, "_authed_get", lambda email, path, **kw: None)
    assert ms.microsoft_get_inline_parts("a@b.c", "m1", {"x@mx"}) == {}
    assert ms.microsoft_get_inline_parts("a@b.c", "m1", set()) == {}
