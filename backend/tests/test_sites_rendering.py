"""Actual static rendering and native Pangea transport with disposable state."""
from __future__ import annotations

import contextlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.domains.sites import pangea
from backend.domains.sites.models import PublicRecord, SiteBlock, SiteBundle, SiteConfig, SitePage, SiteSource, SiteTarget
from backend.domains.sites.paths import extension_root
from backend.domains.sites.renderer import render_bundle
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext


@pytest.mark.skipif(not (extension_root() / "renderer/node_modules/node/bin/node").is_file(), reason="Pinned renderer runtime must be prepared")
def test_packaged_renderer_never_writes_to_sealed_dependency_cache(tmp_path, monkeypatch):
    runtime = tmp_path / 'sealed-extension'
    renderer = runtime / 'renderer'
    renderer.mkdir(parents=True)
    source = extension_root() / 'renderer'
    for name in ('src', 'scripts', 'astro.config.mjs', 'package.json'):
        (renderer / name).symlink_to(source / name, target_is_directory=(source / name).is_dir())
    modules = renderer / 'node_modules'
    modules.mkdir()
    for package in (source / 'node_modules').iterdir():
        if not package.name.startswith('.'):
            (modules / package.name).symlink_to(package.resolve(), target_is_directory=package.is_dir())
    sealed = modules / '.astro'
    sealed.mkdir()
    marker = sealed / 'signed-resource'
    marker.write_text('must stay byte-identical')
    sealed.chmod(0o555)
    modules.chmod(0o555)
    monkeypatch.setattr('backend.domains.sites.renderer.extension_root', lambda: runtime)
    try:
        site = SiteConfig(name='Sealed runtime')
        site.pages = [SitePage(title='Public preview', path='/ca', enabled=True)]
        output = tmp_path / 'public'
        render_bundle(SiteBundle(site=site).model_dump(mode='json'), output)
        assert (output / 'ca/index.html').is_file()
        assert (output / 'pagefind/pagefind.js').is_file()
        assert marker.read_text() == 'must stay byte-identical'
        assert list(sealed.iterdir()) == [marker]
        assert not (modules / '.vite').exists()
    finally:
        modules.chmod(0o755)
        sealed.chmod(0o755)


@pytest.mark.skipif(not (extension_root() / "renderer/node_modules/node/bin/node").is_file(), reason="Pinned renderer runtime must be prepared")
def test_actual_astro_output_scopes_assets_and_forms_without_private_snapshot(tmp_path):
    site = SiteConfig(name="Example", origin="https://example.invalid")
    site.forms[0].enabled = True
    site.pages = [SitePage(id="home", title="Public heading", language="ca", path="/ca", enabled=True,
                           blocks=[SiteBlock(type="text", body="**Public** body"), SiteBlock(type="form", form_id="contact")])]
    opaque = "ad740e3b-542c-40d9-ae8f-e97cefad6d0c"
    site.sources = [SiteSource(id="articles", kind="table", source_id="articles", title="Articles", enabled=True, presentation="table", path_prefix="/content", field_ids=[opaque])]
    record = PublicRecord(id="public-record", language="ca", path="/ca/content/record", title="Public article", source_ids=["articles"], fields={opaque: "Public value"}, field_labels={opaque: "Public summary"})
    bundle = SiteBundle(site=site, records=[record]).model_dump(mode="json")
    bundle["source_hashes"] = {"private-path/NEVER-PUBLISH.md": "private-fingerprint"}
    bundle["deployment_url"] = "https://example.invalid/_gnosi-proof/current"
    output = tmp_path / "public"
    render_bundle(bundle, output)
    html = (output / "ca/index.html").read_text()
    assert '<strong>Public</strong>' in html
    record_html = (output / "ca/content/record/index.html").read_text()
    collection_html = (output / "ca/content/index.html").read_text()
    assert '<dt>Public summary</dt>' in record_html
    assert '<th>Public summary</th>' in collection_html
    assert opaque not in record_html and opaque not in collection_html
    assert 'action="/_gnosi-proof/current/api/contact.php"' in html
    assert 'href="/_gnosi-proof/current/_astro/' in html
    assert 'name="values[email]"' in html and 'name="values[message]"' in html
    assert "https://example.invalid/ca" in (output / "sitemap.xml").read_text()
    assert (output / "pagefind/pagefind.js").is_file()
    from bs4 import BeautifulSoup
    search = BeautifulSoup((output / "ca/search/node/index.html").read_text(), "html.parser")
    spanish = search.select_one('.masthead a[lang="es"]')
    assert spanish['href'] == '/_gnosi-proof/current/es/search/node'
    assert spanish.has_attr('data-search-language')
    map_page = BeautifulSoup((output / "ca/mapa-web/index.html").read_text(), "html.parser")
    assert map_page.select_one('.masthead a[lang="es"]')['href'] == '/_gnosi-proof/current/es/mapa-web'
    assert not (output / "bundle.json").exists()
    assert "NEVER-PUBLISH" not in "".join(path.read_text() for path in output.rglob("*.html"))


@pytest.mark.skipif(shutil.which("php") is None, reason="PHP is required")
def test_native_pangea_upload_verify_service_and_rollback_without_remote_access(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "device"))
    store = SiteStore(WorkspaceContext("workspace", "owner", "owner", vault))
    site = SiteConfig(name="Synthetic Pangea", targets=[SiteTarget(id="pangea", adapter="legacy-pangea", environment="staging", enabled=True, base_url="https://example.invalid/_gnosi-proves/webs/test/current")])
    site.targets[0].base_url = "https://temenosismael.org/_gnosi-proves/webs/" + site.id + "/current"
    site = store.save(site, create=True)
    remote = tmp_path / "account"
    marker = remote / "web/_gnosi-proves/.gnosi-staging-marker"
    marker.parent.mkdir(parents=True)
    marker.write_text("Owned existing staging")

    class LocalBridge:
        def run(self, command):
            return subprocess.run(command, shell=True, capture_output=True, text=True, check=True).stdout

    class LocalDriver:
        REMOTE_ROOT = str(remote)
        CONFIG = tmp_path / "unused.json"

        @contextlib.contextmanager
        def bridge(self):
            yield LocalBridge()

        def php(self, bridge, code):
            return subprocess.run([shutil.which("php"), "-r", code], capture_output=True, text=True, check=True).stdout

        def put(self, bridge, source, destination):
            shutil.copyfile(source, destination)

    monkeypatch.setattr(pangea, "driver", lambda store: LocalDriver())
    monkeypatch.setattr(pangea, "_start_worker", lambda *args: None)
    output = tmp_path / "output"
    output.mkdir()
    (output / "index.html").write_text("Synthetic public body")
    (output / ".htaccess").write_text("Options -Indexes\nRewriteEngine On\n")
    first, second = "a" * 32, "b" * 32
    target = site.targets[0]
    pangea.upload_release(store, site, target, first, output, None)
    assert pangea.current_release(store, site, target) == first
    public, private = pangea.paths(LocalDriver(), site)
    assert not Path(private).is_relative_to(remote / "web")
    assert "RewriteEngine On" in (Path(public) / "current/.htaccess").read_text()
    assert "SetEnv GNOSI_SITES_SERVICE_CONFIG" in (Path(public) / "current/.htaccess").read_text()
    status = pangea.service(store, site, "pangea", "status", {})
    assert status["test_mode"] is True
    assert not (Path(public) / "current/config.json").exists()
    pangea.upload_release(store, site, target, second, output, first)
    pangea.revert(store, site, target, first, second)
    assert pangea.current_release(store, site, target) == first
    (Path(private) / "releases" / first / "public/index.html").write_text("Corrupted retained release")
    with pytest.raises(subprocess.CalledProcessError):
        pangea.current_release(store, site, target)


def test_pangea_read_deadline_is_shared_across_login_and_commands(monkeypatch):
    from fastapi import HTTPException
    from backend.domains.sites.bounded_bridge import BoundedBridge

    clock = [100.0]
    monkeypatch.setattr('backend.domains.sites.bounded_bridge.time.monotonic', lambda: clock[0])
    bridge = BoundedBridge({}, timeout=5)

    class SlowChild:
        timeout = 0.0
        before = ''
        closed = False

        def sendline(self, value):
            clock[0] += 6
            return len(value)

        def expect(self, pattern):
            pytest.fail('An expired session must not enter another SSH wait')

        def close(self, force=True):
            self.closed = True

    child = SlowChild()
    bridge.child = child
    bridge.settings = {'DRUPAL_PATH': '/owned'}
    with pytest.raises(HTTPException) as error:
        bridge.run('true')
    assert error.value.status_code == 503
    assert child.closed and bridge.child is None


@pytest.mark.skipif(not (extension_root() / "renderer/node_modules/node/bin/node").is_file(), reason="Pinned renderer runtime must be prepared")
def test_imported_contact_and_taxonomy_keep_equivalent_translations(tmp_path, monkeypatch):
    from backend.domains.sites.importer import seed_import
    from bs4 import BeautifulSoup

    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path / 'device'))
    vault = tmp_path / 'vault'
    vault.mkdir()
    store = SiteStore(WorkspaceContext('workspace', 'owner', 'owner', vault))
    pilot = tmp_path / 'pilot'
    for directory in ('src/data', 'src/styles', 'scripts', 'config', 'public'):
        (pilot / directory).mkdir(parents=True)
    (pilot / 'src/data/site.json').write_text(json.dumps({'languages': ['ca', 'es'], 'nodes': [], 'routes': [
        {'kind': 'tag', 'tid': 1, 'lang': lang, 'title': 'Tag', 'path': '/' + lang + '/tag/test'} for lang in ('ca', 'es')] + [
        {'kind': 'confirmation', 'lang': 'es', 'path': '/es/form/contact/confirmation'},
        {'kind': 'redirect', 'path': '/ca/cerca', 'target': '/ca/search/node'},
        {'kind': 'redirect', 'path': '/es/cerca', 'target': '/es/search/node'},
        {'kind': 'redirect', 'path': '/ca/site-map', 'target': '/ca/mapa-web'},
        *[{'kind': 'redirect', 'path': path, 'target': '/ca/mapa-web'} for path in ('/mapa-web', '/site-map', '/sitemap')],
        {'kind': 'redirect', 'path': '/search/node', 'target': '/ca/search/node'},
    ]}))
    (pilot / 'src/styles/brand.css').write_text('')
    (pilot / 'scripts/web_publish_driver.py').write_text('')
    (pilot / 'config/resource-types.json').write_text('{}')
    (pilot / 'config/homepage.json').write_text('{}')
    site = SiteConfig(name='Synthetic', legacy_pilot=True)
    seed_import(store, site, pilot)
    for stem in ('home', 'contact', 'tag-1'):
        translations = [page for page in site.pages if page.id in {stem + '-ca', stem + '-es'}]
        assert len(translations) == 2
        assert translations[0].translation_id == translations[1].translation_id
        assert translations[0].translation_id
    # The complete renderer must use those identities for the visible language links.
    site.theme.logo = ''
    output = tmp_path / 'public'
    render_bundle(SiteBundle(site=site).model_dump(mode='json'), output)
    for route in ('form/contact', 'tag/test'):
        html = BeautifulSoup((output / 'ca' / route / 'index.html').read_text(), 'html.parser')
        assert html.select_one('.masthead a[lang="es"]')['href'] == '/es/' + route
    research = BeautifulSoup((output / 'es/investigacio/index.html').read_text(), 'html.parser')
    assert research.h1.get_text() == 'Investigación'
    assert research.select_one('.masthead a[lang="ca"]')['href'] == '/ca/investigacio'
    assert 'Investigación' in [link.label for link in site.navigation if link.language == 'es']
    assert site.redirects['/es/form/contact/confirmation'] == '/es/form/contact'
    confirmation = BeautifulSoup((output / 'es/form/contact/confirmation/index.html').read_text(), 'html.parser')
    assert confirmation.select_one('meta[http-equiv="refresh"]')['content'].endswith('/es/form/contact')
    for alias, target in {'/ca/cerca': '/ca/search/node', '/es/cerca': '/es/search/node', '/ca/site-map': '/ca/mapa-web', '/mapa-web': '/ca/mapa-web', '/site-map': '/ca/mapa-web', '/sitemap': '/ca/mapa-web', '/search/node': '/ca/search/node'}.items():
        assert site.redirects[alias] == target
        assert (output / target.lstrip('/') / 'index.html').is_file()
        redirect = BeautifulSoup((output / alias.lstrip('/') / 'index.html').read_text(), 'html.parser')
        assert redirect.select_one('meta[http-equiv="refresh"]')['content'].endswith(target)


@pytest.mark.skipif(shutil.which('php') is None, reason='PHP is required')
def test_running_local_server_follows_atomic_publication_and_rollback(tmp_path, monkeypatch):
    import socket
    import urllib.request
    from backend.domains.sites import runtime
    from backend.domains.sites.models import TargetConnection

    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path / 'device'))
    vault = tmp_path / 'vault'
    vault.mkdir()
    store = SiteStore(WorkspaceContext('workspace', 'owner', 'owner', vault))
    site = store.save(SiteConfig(name='Live local proof'), create=True)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    runtime.save_connection(store, site.id, 'local', TargetConnection(local_port=port))
    # The daemon has independent service tests; isolate this test to HTTP version switching.
    monkeypatch.setattr(runtime, 'SERVICE_ROOT', tmp_path / 'no-daemon')
    # Use the fixed shipped router while avoiding a background daemon in this test.
    (tmp_path / 'public').mkdir()
    shutil.copyfile(extension_root() / 'public/router.php', tmp_path / 'public/router.php')
    first = store.site_dir(site.id) / 'releases' / ('a' * 32) / 'public'
    second = store.site_dir(site.id) / 'releases' / ('b' * 32) / 'public'
    for output, body in ((first, 'First reviewed version'), (second, 'Second reviewed version')):
        output.mkdir(parents=True)
        (output / 'index.html').write_text(body)
    active = store.site_dir(site.id) / 'active/local'
    active.parent.mkdir()
    active.symlink_to(first, target_is_directory=True)
    try:
        url = runtime.start_server(store, site, 'local', active)
        state_path = store.site_dir(site.id) / 'servers/local/server.json'
        pid = json.loads(state_path.read_text())['pid']
        assert urllib.request.urlopen(url, timeout=3).read() == b'First reviewed version'
        pending = active.with_name('pending')
        pending.symlink_to(second, target_is_directory=True)
        pending.replace(active)
        assert urllib.request.urlopen(url, timeout=3).read() == b'Second reviewed version'
        pending.symlink_to(first, target_is_directory=True)
        pending.replace(active)
        assert urllib.request.urlopen(url, timeout=3).read() == b'First reviewed version'
        assert json.loads(state_path.read_text())['pid'] == pid
    finally:
        runtime.stop_server(store, site, 'local')
