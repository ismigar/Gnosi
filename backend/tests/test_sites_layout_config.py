"""Persistent editorial controls for shared website layout components."""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.domains.sites.models import NavigationLink, SiteBlock, SiteConfig, SiteSource
from backend.domains.sites.validation import validate_site
from backend.tests.test_sites import website as website
from backend.tests.test_sites_imported_pilot import imported_pilot as imported_pilot


def test_header_and_hero_actions_survive_save_and_removal(website):
    site = website.site
    site.header_actions = [NavigationLink(label='Support', href='/ca/support', language='ca', appearance='button')]
    site.pages[0].blocks[0].actions = [NavigationLink(label='About', href='/ca/about', appearance='outline')]
    site.sources[0].page_size = 8
    site.sources[0].show_tag_filter = True
    saved = website.store.save(site)
    restored = website.store.load(saved.id)
    assert restored.header_actions[0].label == 'Support'
    assert restored.header_actions[0].appearance == 'button'
    assert restored.pages[0].blocks[0].actions[0].href == '/ca/about'
    assert restored.sources[0].page_size == 8 and restored.sources[0].show_tag_filter
    restored.pages[0].blocks[0].actions = []
    assert website.store.save(restored).pages[0].blocks[0].actions == []


def test_old_config_distinguishes_unconfigured_and_removed_actions():
    old = SiteConfig.model_validate({'name': 'Old website', 'pages': [{'title': 'Home', 'blocks': [{'type': 'split'}]}]})
    assert old.header_actions == []
    assert old.pages[0].blocks[0].actions is None
    assert SiteBlock(actions=[]).actions == []


@pytest.mark.parametrize('where', ['header', 'hero'])
@pytest.mark.parametrize('destination', ['javascript:alert(1)', 'https://user:secret@example.invalid/', '//example.invalid/'])
def test_new_action_destinations_use_existing_public_link_policy(where, destination):
    site = SiteConfig(name='Example')
    link = NavigationLink(label='Action', href=destination)
    if where == 'header':
        site.header_actions = [link]
    else:
        from backend.domains.sites.models import SitePage
        site.pages = [SitePage(title='Home', blocks=[SiteBlock(actions=[link])])]
    with pytest.raises(HTTPException):
        validate_site(site)


def test_action_language_and_pagination_are_bounded():
    with pytest.raises(HTTPException):
        validate_site(SiteConfig(name='Example', header_actions=[NavigationLink(label='Action', href='/ca', language='xx')]))
    for page_size in (0, 101):
        with pytest.raises(ValidationError):
            SiteSource(source_id='source', page_size=page_size)


def test_new_import_preserves_privacy_and_exposes_public_filters(imported_pilot):
    _, site, _, _ = imported_pilot
    assert site.forms[0].require_privacy
    assert site.forms[0].privacy_url == '/politica-de-privacitat'
    assert next(source for source in site.sources if source.source_id == 'imported:blog').show_tag_filter
    assert all(page.blocks[0].actions == [] for page in site.pages if page.template == 'home')
