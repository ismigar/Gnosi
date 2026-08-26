"""Tests for the clone's attachment download/location helpers (pure)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.notion_attachments import (  # noqa: E402
    is_remote, filename_for, localize_values, localize_body, download_to,
    resolve_file_markers,
)
from services.notion_mcp_md import file_marker  # noqa: E402

S3 = "https://prod-files-secure.s3.amazonaws.com/abc/foto.png?X-Amz-Signature=xyz"


def fake_save(mapping):
    return lambda url, prop: mapping.get(url)


def test_is_remote():
    assert is_remote(S3) and is_remote("http://x.com/a")
    assert not is_remote("Assets/x.png") and not is_remote("") and not is_remote(None)


def test_filename_for_strips_query_and_hashes():
    f = filename_for(S3)
    assert f.startswith("foto_") and f.endswith(".png") and "?" not in f
    # stable for the same URL, different for another
    assert f == filename_for(S3)
    assert f != filename_for(S3.replace("foto", "altra"))


def test_filename_for_no_ext_uses_content_type_default():
    f = filename_for("https://x.com/files/12345", default_ext="jpg")
    assert f.endswith(".jpg")


def test_localize_values_downloads_file_fields_only():
    props = [{"name": "Foto", "type": "files"}, {"name": "Nom", "type": "title"},
             {"name": "Web", "type": "url"}]
    values = {"Foto": [S3], "Nom": "Hola", "Web": "https://example.com"}
    out, n = localize_values(values, props, fake_save({S3: "Assets/Clon/Taula/Foto/foto_x.png"}))
    assert n == 1
    assert out["Foto"] == ["Assets/Clon/Taula/Foto/foto_x.png"]
    assert out["Nom"] == "Hola"                     # not a file field
    assert out["Web"] == "https://example.com"      # url ≠ asset → intacte


def test_localize_values_keeps_url_on_failed_download():
    props = [{"name": "Foto", "type": "image"}]
    out, n = localize_values({"Foto": [S3]}, props, fake_save({}))  # no mapping → fails
    assert n == 0 and out["Foto"] == [S3]


def test_localize_body_rewrites_remote_images_only():
    md = f"Text\n\n![cap]({S3})\n\n![local](Assets/ja/local.png)\n"
    out, n = localize_body(md, fake_save({S3: "Assets/Clon/Taula/_cos/foto_x.png"}))
    assert n == 1
    assert "![cap](Assets/Clon/Taula/_cos/foto_x.png)" in out
    assert "![local](Assets/ja/local.png)" in out   # ja local → intacte


def test_localize_body_empty():
    assert localize_body("", fake_save({})) == ("", 0)


def test_download_to_non_remote_returns_none(tmp_path=Path("/tmp/gnosi_att_test")):
    assert download_to("Assets/x.png", tmp_path, tmp_path) is None


BID = "1ee268e52714806abc67e2b2ee6d3cbb"


def test_resolve_file_markers_downloads_and_links():
    md = f"Abans\n{file_marker(BID, 'Notes del curs.pdf')}\nDesprés"
    out, ok, fail = resolve_file_markers(
        md, lambda bid: S3 if bid == BID else None,
        lambda url, prop: "Assets/Clon/Recursos/_cos/Notes_x.pdf" if url == S3 else None)
    assert (ok, fail) == (1, 0)
    assert "[Notes del curs.pdf](Assets/Clon/Recursos/_cos/Notes_x.pdf)" in out
    assert "gnosi-notion-file" not in out
    assert "Abans" in out and "Després" in out


def test_resolve_file_markers_degrades_to_readable_text():
    md = file_marker(BID, "EE_ismaelGarcia_incipit2012.doc")
    # no fresh URL (deleted block / no permission) → plain filename, NEVER a raw marker
    out, ok, fail = resolve_file_markers(md, lambda bid: None, lambda url, prop: "x")
    assert (ok, fail) == (0, 1) and out == "📎 EE_ismaelGarcia_incipit2012.doc"
    # URL available but downloads disabled (save_asset=None) → same degradation
    out, ok, fail = resolve_file_markers(md, lambda bid: S3, None)
    assert (ok, fail) == (0, 1) and out == "📎 EE_ismaelGarcia_incipit2012.doc"
    # failed download (save_asset returns None)
    out, ok, fail = resolve_file_markers(md, lambda bid: S3, lambda url, prop: None)
    assert (ok, fail) == (0, 1) and "📎" in out


def test_resolve_file_markers_no_markers_untouched():
    md = "Text normal amb [un enllaç](Assets/x.pdf)"
    assert resolve_file_markers(md, lambda bid: S3, lambda u, p: "y") == (md, 0, 0)
    assert resolve_file_markers("", lambda bid: S3, None) == ("", 0, 0)


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn(); print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1; print(f"FAIL {fn.__name__}"); traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} OK")
    sys.exit(1 if failed else 0)
