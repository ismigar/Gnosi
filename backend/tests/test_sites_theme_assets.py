"""Theme uploads use disposable vaults and never publish or send mail."""
from __future__ import annotations
import io
from pathlib import Path
import pytest
from fastapi import HTTPException
from PIL import Image
from backend.domains.sites import exporter, theme_assets
from backend.domains.sites.models import SiteConfig
from backend.tests.test_sites import website as website


def png() -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", (1200, 300), (20, 40, 60, 0)).save(output, format="PNG")
    return output.getvalue()


def test_upload_keeps_original_and_transparency_and_exports_only_selected_assets(website):
    source, _ = theme_assets.upload(website.store, website.site, "../../logo.png", png(), "image")
    assert source.startswith("/.gnosi/sites/assets/" + website.site.id + "/")
    assert website.store.load(website.site.id).theme.logo == ""
    assert not exporter.build_bundle(website.store, website.site, "local").assets
    raw = theme_assets.read_asset(website.store, website.site, source)
    preview = Image.open(io.BytesIO(theme_assets.image_preview(raw, ".png")))
    assert preview.size == (320, 80)
    assert preview.getpixel((0, 0))[3] == 0
    site = website.site.model_copy(deep=True); site.theme.logo = source
    bundle = exporter.build_bundle(website.store, site, "local")
    assert len(bundle.assets) == 1
    assert Path(bundle.assets[0].private_source).read_bytes() == png()
    assert bundle.site.theme.logo.startswith("/assets/")


def test_asset_preview_refuses_other_sites_and_private_files(website):
    source, _ = theme_assets.upload(website.store, website.site, "logo.png", png(), "image")
    other = website.store.save(SiteConfig(name="Other"), create=True)
    for secret in (source, "/BD/Articles/one.md", "/.gnosi/sites/assets/" + other.id + "/../" + website.site.id + "/" + source.split("/")[-1]):
        with pytest.raises(HTTPException):
            theme_assets.read_asset(website.store, other, secret)


@pytest.mark.parametrize("name,raw,kind", [("logo.svg", b'<svg onload="alert(1)"/>', "image"), ("logo.png", b"invalid", "image"), ("font.woff2", b"wOF2broken", "font"), ("font.ttf", b"invalid", "font"), ("logo.png", b"x" * 4_000_001, "image")])
def test_invalid_or_oversized_uploads_leave_no_asset(website, name, raw, kind):
    with pytest.raises(HTTPException):
        theme_assets.upload(website.store, website.site, name, raw, kind)
    assert not list(website.store.config_root.rglob("*.png"))
    assert website.store.load(website.site.id).revision == website.site.revision


def test_upload_http_permissions_and_preview_do_not_save_config(website, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.domains.sites import api
    from backend.domains.sites.storage import SiteStore
    from backend.services.workspace_service import get_workspace_context
    app = FastAPI(); app.include_router(api.router, prefix="/api/vault")
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    app.dependency_overrides[get_workspace_context] = lambda: website.context
    monkeypatch.setattr(api, "store_for", lambda context: SiteStore(context))
    prefix = "/api/vault/sites/" + website.site.id + "/theme/"
    with TestClient(app) as client:
        response = client.post(prefix + "assets", params={"kind": "image"}, files={"file": ("logo.png", png(), "image/png")})
        assert response.status_code == 201
        source = response.json()["source"]
        preview = client.get(prefix + "image", params={"source": source})
        assert preview.status_code == 200
        assert preview.headers["cache-control"] == "no-store"
        assert preview.headers["content-type"] == "image/png"
        assert website.store.load(website.site.id).revision == website.site.revision
        website.context.role = "viewer"
        assert client.post(prefix + "assets", params={"kind": "image"}, files={"file": ("logo.png", png(), "image/png")}).status_code == 403
        assert client.get(prefix + "image", params={"source": source}).status_code == 403


def test_uploaded_font_can_be_sampled_before_autosave_and_survives_export(website):
    from backend.domains.sites.fonts import preview_font
    from backend.domains.sites.models import SiteFont
    raw = b"\x00\x01\x00\x00" + b"\x00\x01" + b"\x00" * 6 + b"test" + b"\x00" * 4 + (28).to_bytes(4, "big") + (4).to_bytes(4, "big") + b"font"
    source, media_type = theme_assets.upload(website.store, website.site, "Example.ttf", raw, "font")
    assert media_type == "font/ttf"
    assert preview_font(website.store, website.site, source) == (raw, "font/ttf")
    assert not website.store.load(website.site.id).theme.fonts
    site = website.site.model_copy(deep=True)
    site.theme.fonts = [SiteFont(family="Example", src=source)]
    bundle = exporter.build_bundle(website.store, site, "local")
    assert bundle.site.theme.fonts[0].src.endswith(".ttf")
    assert Path(bundle.assets[0].private_source).read_bytes() == raw


def test_chunked_multipart_is_bounded_before_spooling_the_whole_upload(website, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.domains.sites import api
    from backend.domains.sites.storage import SiteStore
    from backend.services.workspace_service import get_workspace_context
    app = FastAPI(); app.include_router(api.router, prefix="/api/vault")
    app.dependency_overrides[api.router.dependencies[0].dependency] = lambda: None
    app.dependency_overrides[get_workspace_context] = lambda: website.context
    monkeypatch.setattr(api, "store_for", lambda context: SiteStore(context))
    def chunks():
        yield b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="large.png"\r\nContent-Type: image/png\r\n\r\n'
        for _ in range(65):
            yield b"x" * 65_536
        yield b"\r\n--boundary--\r\n"
    with TestClient(app) as client:
        response = client.post("/api/vault/sites/" + website.site.id + "/theme/assets?kind=image", content=chunks(), headers={"Content-Type": "multipart/form-data; boundary=boundary"})
        assert response.status_code == 413
    assert not (website.store.config_root / "assets").exists()


@pytest.mark.parametrize("suffix,format_name,media_type", [(".jpg", "JPEG", "image/jpeg"), (".webp", "WEBP", "image/webp"), (".png", "PNG", "image/png")])
def test_upload_metadata_describes_the_original_image_bytes(website, suffix, format_name, media_type):
    output = io.BytesIO(); Image.new("RGB", (8, 8), (20, 40, 60)).save(output, format=format_name)
    source, actual = theme_assets.upload(website.store, website.site, "logo" + suffix, output.getvalue(), "image")
    assert actual == media_type
    assert theme_assets.read_asset(website.store, website.site, source) == output.getvalue()
