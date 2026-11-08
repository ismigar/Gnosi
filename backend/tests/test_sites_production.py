"""Production delivery stays distinct from staging capture and local previews."""
import json

import pytest
from fastapi import HTTPException

from backend.domains.sites import private_service, production, ssh_namespace
from backend.domains.sites.models import ServiceSettings, SiteTarget
from backend.tests.test_sites import website  # noqa: F401


def target(**updates):
    values = dict(id="live", adapter="ssh", environment="production", base_url="https://example.org", enabled=True)
    return SiteTarget(**(values | updates))


@pytest.mark.parametrize("destination,settings", [
    (target(environment="staging"), ServiceSettings(test_mode=False, delivery_transport="server-mail", sender_email="site@example.org")),
    (target(adapter="local"), ServiceSettings(test_mode=False, sender_email="site@example.org")),
    (target(base_url="http://example.org"), ServiceSettings(test_mode=False, sender_email="site@example.org")),
    (target(), ServiceSettings(test_mode=True)),
    (target(), ServiceSettings(test_mode=False, delivery_transport="server-mail")),
    (target(), ServiceSettings(test_mode=False, smtp_host="mail.example.org", smtp_security="none", sender_email="site@example.org")),
])
def test_unreviewed_delivery_is_rejected(destination, settings):
    with pytest.raises(HTTPException):
        production.validate_delivery(destination, settings)


def test_server_mail_requires_explicit_production_and_sender():
    production.validate_delivery(target(), ServiceSettings(test_mode=False, delivery_transport="server-mail", sender_email="site@example.org"))


def test_production_preview_never_materializes_live_delivery(website, monkeypatch):
    destination = target()
    site = website.site.model_copy(deep=True)
    site.targets.append(destination)
    site = website.store.save(site)
    root = private_service.service_root(website.store, site.id, destination.id)
    settings = ServiceSettings(test_mode=False, delivery_transport="server-mail", sender_email="site@example.org")
    (root / "settings.json").write_text(settings.model_dump_json())
    monkeypatch.setattr("backend.security.keychain_manager.get_keychain", lambda: pytest.fail("Preview read the credential store"))
    config = json.loads(private_service.configuration(website.store, site, destination.id, preview=True).read_text())
    assert config["test_mode"] is True
    assert config["allow_delivery"] is False
    assert "password" not in config["smtp"]
    assert not (root / "config.json").exists()
    live = json.loads(private_service.configuration(website.store, site, destination.id).read_text())
    assert live["test_mode"] is False
    assert live["allow_delivery"] is True
    assert live["delivery_transport"] == "server-mail"


def test_existing_destination_cannot_be_reinterpreted_as_production(website):
    site = website.site.model_copy(deep=True)
    root = private_service.service_root(website.store, site.id, site.targets[0].id)
    (root / "state.sqlite").write_bytes(b"capture state")
    site.targets[0].environment = "production"
    with pytest.raises(HTTPException, match="separate destination"):
        website.store.save(site)


def test_namespace_policy_is_explicit_and_defaults_to_capture():
    stage = ssh_namespace.program("/isolated", "/private", None)
    live = ssh_namespace.program("/isolated", "/private", None, production=True)
    assert "$production=false;" in stage
    assert "$production=true;" in live


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_real_renderer_delivery_and_indexing_match_environment(tmp_path, environment):
    from bs4 import BeautifulSoup
    from backend.domains.sites.models import SiteBlock, SiteBundle, SiteConfig, SitePage
    from backend.domains.sites.renderer import render_bundle
    site = SiteConfig(name="Production proof", origin="https://example.org")
    site.footer_blocks = [SiteBlock(type="newsletter")]
    site.pages = [SitePage(title="Home", path="/ca", language="ca", enabled=True)]
    bundle = SiteBundle(site=site).model_dump(mode="json")
    bundle.update(deployment_environment=environment, deployment_url="https://example.org")
    output = tmp_path / environment
    render_bundle(bundle, output)
    html = BeautifulSoup((output / "ca/index.html").read_text(), "html.parser")
    live = environment == "production"
    assert html.select_one('meta[name="robots"]')["content"] == ("index,follow" if live else "noindex,nofollow")
    assert bool(html.select_one(".preview")) is not live
    email = html.select_one('form input[name="email"]')
    assert email is not None
    assert email.has_attr("pattern") is not live
    assert ("Disallow: /" in (output / "robots.txt").read_text()) is not live
    assert ("noindex" in (output / ".htaccess").read_text()) is not live


def test_root_routing_rejects_paths_that_escape_owned_namespace():
    from backend.domains.sites.production_routing import root_htaccess
    for path in ["/", "/_gnosi-proves/current", "/_gnosi-live/webs/../../current", "\nRequire all granted"]:
        with pytest.raises(ValueError):
            root_htaccess(path)
    with pytest.raises(ValueError):
        root_htaccess("/_gnosi-live/webs/" + "a" * 32 + "/current", ["/gone\nRequire all granted"])


@pytest.mark.parametrize("source_environment,destination_environment", [
    ("local", "production"), ("staging", "production"), ("production", "staging"),
])
def test_removed_identity_cannot_cross_delivery_boundary(website, source_environment, destination_environment):
    from backend.domains.sites.models import SiteTarget
    site = website.site.model_copy(deep=True)
    stage = SiteTarget(id="reused", adapter="ssh", environment=source_environment, base_url="https://example.org/test")
    site.targets.append(stage)
    site = website.store.save(site)
    root = private_service.service_root(website.store, site.id, "reused")
    (root / "state.sqlite").write_bytes(b"retained staging state")
    site.targets = [t for t in site.targets if t.id != "reused"]
    site = website.store.save(site)
    site.targets.append(stage.model_copy(update={"environment": destination_environment}))
    with pytest.raises(HTTPException, match="separate destination"):
        website.store.save(site)
    assert (root / "state.sqlite").read_bytes() == b"retained staging state"


@pytest.mark.parametrize("action", ["queue_list", "campaigns_list", "forms_sync"])
def test_cli_success_envelope_always_binds_capture_mode(website, action):
    data = private_service.invoke(website.store, website.site, action, {}, internal=action == "forms_sync")
    assert data["test_mode"] is True


def test_default_live_private_namespace_is_separate_from_capture(website):
    from backend.domains.sites.models import TargetConnection
    from backend.domains.sites.runtime import remote_private_root
    settings = TargetConnection(remote_root="/account/web/_gnosi-site", document_root="/account/web")
    capture = remote_private_root(website.store, website.site.id, settings)
    live = remote_private_root(website.store, website.site.id, settings, production_target_id="live")
    assert live != capture
    assert live.endswith("/production/live")


def test_unused_destination_draft_can_select_its_environment(website):
    site = website.site.model_copy(deep=True)
    site.targets[0].environment = "production"
    site.targets[0].adapter = "ssh"
    site.targets[0].base_url = "https://example.org"
    saved = website.store.save(site)
    assert saved.targets[0].environment == "production"
