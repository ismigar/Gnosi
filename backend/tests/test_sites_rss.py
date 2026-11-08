"""Actual local publication regenerates RSS from the reviewed public projection."""
import xml.etree.ElementTree as ET

import pytest

from backend.domains.sites import publication, runtime
from backend.domains.sites.models import SitePublishRequest
from backend.domains.sites.paths import extension_root
from backend.tests.test_sites import website as website


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_newly_published_content_enters_rss_without_duplicate_items(website, monkeypatch):
    monkeypatch.setattr(runtime, 'start_server', lambda *args, **kwargs: 'http://127.0.0.1:4322')
    monkeypatch.setattr(publication, 'dispatch', lambda *args: None)
    monkeypatch.setattr(publication, 'plugins_enabled_now', lambda *args, **kwargs: True)
    monkeypatch.setattr('backend.domains.sites.private_service.invoke', lambda *args, **kwargs: {})
    site = website.site
    active = website.store.site_dir(site.id) / 'active/local'

    def publish():
        review = publication.preview(website.store, site, 'local')
        job = publication.enqueue(website.store, site, SitePublishRequest(preview_id=review.id))
        publication._run(website.store, job)
        assert publication.jobs(website.store, site.id)[0].status == 'completed'
        return ET.fromstring((active / 'ca/rss.xml').read_bytes()).findall('channel/item')

    before = publish()
    assert [item.findtext('title') for item in before] == ['First article']
    draft = website.vault / 'BD/Articles/two.md'
    draft.write_text('---\nid: two\ntable_id: articles\ntitle: Newly published & readable\nIdioma: ca\nStatus: published\n---\nNewly public body.\n')
    after = publish()
    assert {item.findtext('title') for item in after} == {'First article', 'Newly published & readable'}
    assert len({item.findtext('guid') for item in after}) == len(after) == 2
    assert before[0].findtext('guid') in {item.findtext('guid') for item in after}
    new = next(item for item in after if item.findtext('title') == 'Newly published & readable')
    assert 'Newly public body.' in new.findtext('description')
    destination = next(target.base_url for target in site.targets if target.id == 'local')
    assert new.findtext('link').startswith(destination.rstrip('/') + '/')
    assert (active / 'rss.xml').read_bytes() == (active / 'ca/rss.xml').read_bytes()
    assert not ET.fromstring((active / 'es/rss.xml').read_bytes()).findall('channel/item')
