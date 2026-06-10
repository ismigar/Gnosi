"""Tests for backend/services/mail_inline_images.py.

What we cover:
    - src="/api/vault/assets/..." (relative, absolute-with-host, URL-encoded)
      becomes cid: and the asset bytes come back as an inline attachment
    - duplicated URLs share one Content-ID / one attachment
    - missing files, traversal attempts, non-images, empty (OneDrive
      dataless) files leave the URL untouched and never raise
    - <a href> to vault files is NOT rewritten (only src attributes)
    - build_mail_content MIME shapes: text only, related (inline), and
      mixed(related + attachments), with matching Content-ID headers

What we deliberately do NOT cover here:
    - Real SMTP/Gmail/Graph sends (need accounts; see directive
      mail_inline_images_cid.md, test pla #5)

Run inside the backend container:
    docker exec gnosi_backend python -m pytest backend/tests/test_mail_inline_images.py -v
"""
from __future__ import annotations

import re

import pytest

from backend.services.context_vars import active_vault_path
from backend.services.mail_inline_images import (
    build_mail_content,
    extract_vault_inline_images,
)

# 1x1 transparent PNG
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfa\xcf"
    b"\xf0\x1f\x00\x05\x05\x02\x00_\xc8\xf1\xd2\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture
def vault(tmp_path):
    """Fake vault with a few Assets, bound as the active vault."""
    inline = tmp_path / "Assets" / "Inline"
    inline.mkdir(parents=True)
    (inline / "test.png").write_bytes(PNG_BYTES)
    (inline / "imatge amb espais.png").write_bytes(PNG_BYTES)
    (inline / "buit.png").write_bytes(b"")
    files = tmp_path / "Assets" / "Files"
    files.mkdir(parents=True)
    (files / "doc.pdf").write_bytes(b"%PDF-1.4 fake")
    (tmp_path / "secret.png").write_bytes(PNG_BYTES)  # fora d'Assets

    token = active_vault_path.set(tmp_path)
    yield tmp_path
    active_vault_path.reset(token)


def test_relative_src_becomes_cid(vault):
    body = '<p>hola</p><img src="/api/vault/assets/Inline/test.png" alt="x">'
    new_body, images = extract_vault_inline_images(body)

    assert len(images) == 1
    img = images[0]
    assert img["data"] == PNG_BYTES
    assert img["content_type"] == "image/png"
    assert img["filename"] == "test.png"
    assert "/api/vault/assets/" not in new_body
    assert f'src="cid:{img["content_id"]}"' in new_body
    # la resta del cos no es toca
    assert new_body.startswith("<p>hola</p>")
    assert 'alt="x"' in new_body


def test_absolute_and_urlencoded_src(vault):
    body = (
        '<img src="https://localhost:5173/api/vault/assets/Inline/'
        'imatge%20amb%20espais.png">'
    )
    new_body, images = extract_vault_inline_images(body)
    assert len(images) == 1
    assert images[0]["filename"] == "imatge amb espais.png"
    assert "cid:" in new_body
    assert "/api/vault/assets/" not in new_body


def test_duplicate_url_shares_cid(vault):
    body = (
        '<img src="/api/vault/assets/Inline/test.png">'
        '<img src="/api/vault/assets/Inline/test.png">'
    )
    new_body, images = extract_vault_inline_images(body)
    assert len(images) == 1
    cids = re.findall(r'cid:([^"]+)', new_body)
    assert len(cids) == 2
    assert cids[0] == cids[1] == images[0]["content_id"]


def test_missing_file_left_intact(vault):
    body = '<img src="/api/vault/assets/Inline/no-existeix.png">'
    new_body, images = extract_vault_inline_images(body)
    assert images == []
    assert new_body == body


def test_traversal_left_intact(vault):
    body = '<img src="/api/vault/assets/../secret.png">'
    new_body, images = extract_vault_inline_images(body)
    assert images == []
    assert new_body == body


def test_non_image_src_left_intact(vault):
    body = '<img src="/api/vault/assets/Files/doc.pdf">'
    new_body, images = extract_vault_inline_images(body)
    assert images == []
    assert new_body == body


def test_empty_dataless_file_left_intact(vault):
    body = '<img src="/api/vault/assets/Inline/buit.png">'
    new_body, images = extract_vault_inline_images(body)
    assert images == []
    assert new_body == body


def test_href_links_not_rewritten(vault):
    body = '<a href="/api/vault/assets/Files/doc.pdf">doc</a>'
    new_body, images = extract_vault_inline_images(body)
    assert images == []
    assert new_body == body


def test_body_without_assets_fast_path(vault):
    body = "<p>res a fer</p>"
    new_body, images = extract_vault_inline_images(body)
    assert new_body == body
    assert images == []


# ── build_mail_content ──────────────────────────────────────────────────────

def _inline_image(cid="abc123@gnosi.local"):
    return {
        "filename": "test.png",
        "content_type": "image/png",
        "data": PNG_BYTES,
        "content_id": cid,
    }


def _attachment():
    return {
        "filename": "doc.pdf",
        "content_type": "application/pdf",
        "data": b"%PDF-1.4 fake",
    }


def test_content_text_only():
    msg = build_mail_content("<p>hola açò és html</p>")
    assert msg.get_content_type() == "text/html"
    assert "hola" in msg.get_payload(decode=True).decode("utf-8")


def test_content_inline_becomes_related():
    msg = build_mail_content('<img src="cid:abc123@gnosi.local">',
                             inline_images=[_inline_image()])
    assert msg.get_content_type() == "multipart/related"
    parts = msg.get_payload()
    assert parts[0].get_content_type() == "text/html"
    img_part = parts[1]
    assert img_part.get_content_type() == "image/png"
    assert img_part["Content-ID"] == "<abc123@gnosi.local>"
    assert img_part.get_content_disposition() == "inline"
    assert img_part.get_payload(decode=True) == PNG_BYTES


def test_content_mixed_wraps_related_and_attachments():
    msg = build_mail_content(
        '<img src="cid:abc123@gnosi.local">',
        attachments=[_attachment()],
        inline_images=[_inline_image()],
    )
    assert msg.get_content_type() == "multipart/mixed"
    related, att = msg.get_payload()
    assert related.get_content_type() == "multipart/related"
    assert att.get_content_type() == "application/pdf"
    assert att.get_content_disposition() == "attachment"
    assert att.get_filename() == "doc.pdf"
    assert att.get_payload(decode=True) == b"%PDF-1.4 fake"


def test_content_attachments_only_keeps_mixed_text():
    msg = build_mail_content("text pla", attachments=[_attachment()])
    assert msg.get_content_type() == "multipart/mixed"
    text, att = msg.get_payload()
    assert text.get_content_type() == "text/plain"
    assert att.get_filename() == "doc.pdf"


def test_extracted_cids_match_mime_headers(vault):
    """End-to-end intern: extracció + builder → cada cid: del cos té part."""
    body = '<p>adjunto la captura</p><img src="/api/vault/assets/Inline/test.png">'
    new_body, images = extract_vault_inline_images(body)
    msg = build_mail_content(new_body, inline_images=images)

    body_cids = set(re.findall(r'cid:([^"]+)', new_body))
    part_cids = {
        p["Content-ID"].strip("<>")
        for p in msg.walk()
        if p["Content-ID"]
    }
    assert body_cids == part_cids != set()
