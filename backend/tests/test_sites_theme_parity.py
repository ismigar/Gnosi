"""Synthetic public-only renderer checks for configurable Webs components."""
from copy import deepcopy
import json

import pytest
from bs4 import BeautifulSoup

from backend.domains.sites.exporter import build_bundle
from backend.domains.sites.paths import extension_root
from backend.domains.sites.renderer import render_bundle
from backend.tests.test_sites_imported_pilot import imported_pilot


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_renderer_configures_actions_and_rich_public_listing(imported_pilot, tmp_path):
    store, site, _, _ = imported_pilot
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    bundle['deployment_url'] = 'https://example.invalid/_gnosi-proof/current'
    bundle['site']['navigation'] = [
        {'label': 'Nav action', 'href': '/ca/navigation', 'appearance': 'button'},
        {'label': 'Inici', 'href': '/ca/'},
        {'label': 'Blog', 'href': '/ca/blog'},
    ]
    bundle['site']['footer'] = [{'label': 'Footer action', 'href': '/ca/footer', 'appearance': 'outline'}]
    bundle['site']['header_actions'] = [
        {'label': 'Col·labora', 'href': '/ca/collabora', 'appearance': 'outline', 'language': 'ca'},
        {'label': 'Spanish only', 'href': '/es/collabora', 'appearance': 'button', 'language': 'es'},
    ]
    for page in bundle['site']['pages']:
        if page['template'] == 'home':
            for block in page['blocks']:
                if block['type'] == 'split':
                    block['actions'] = [] if page['language'] == 'es' else [{'label': 'Configured action', 'href': '/ca/custom', 'appearance': 'button'}]
    source = next(source for source in bundle['site']['sources'] if source['id'] == 'imported-blog')
    source.update(page_size=2, show_tag_filter=True)
    for record in bundle['records']:
        if record['presentation'].get('tags'):
            record['presentation']['image'] = {'url': '/sites/default/files/photo.png', 'alt': 'Synthetic image'}
            record['presentation']['summary'] = 'Public listing summary'
    table_source = next(source for source in bundle['site']['sources'] if source['id'] == 'imported-design')
    table_source.update(presentation='table', page_size=2, show_tag_filter=True)
    design = next(record for record in bundle['records'] if 'imported-design' in record['source_ids'])
    design['fields'] = {'public_material': 'Public material 1'}
    design['field_labels'] = {'public_material': 'Material públic'}
    design['presentation']['tags'] = [{'tid': 11, 'label': 'Public design theme'}]
    for index in (2, 3):
        record = deepcopy(design)
        record.update(id=f'00000000-0000-4000-8000-{index:012d}', path=f'/ca/dissenys/example-{index}', title=f'Public design {index}')
        record['fields']['public_material'] = f'Public material {index}'
        bundle['records'].append(record)
    output = tmp_path / 'public'
    render_bundle(bundle, output)
    home = BeautifulSoup((output / 'ca/index.html').read_text(), 'html.parser')
    action = home.select_one('.header-actions a')
    assert action.get_text() == 'Col·labora'
    assert action['href'] == '/_gnosi-proof/current/ca/collabora'
    assert 'button-outline' in action['class']
    assert 'button' in home.select_one('#site-navigation a')['class']
    assert home.select_one('#site-navigation a[aria-current="page"]').get_text() == 'Inici'
    assert home.select_one('#site-navigation summary[aria-label="Cerca"] svg[aria-hidden="true"]')
    assert 'button-outline' in home.select_one('.site-footer .navigation a')['class']
    toggle = home.select_one('[data-menu-toggle]')
    assert toggle['aria-expanded'] == 'false'
    assert home.find(id=toggle['aria-controls'])
    assert home.select_one('.hero-actions a').get_text() == 'Configured action'
    spanish = BeautifulSoup((output / 'es/index.html').read_text(), 'html.parser')
    assert not spanish.select('.hero-actions a')
    listing = BeautifulSoup((output / 'ca/blog/index.html').read_text(), 'html.parser')
    assert listing.select_one('#site-navigation a[aria-current="page"]').get_text() == 'Blog'
    assert listing.select_one('[data-public-listing]')['data-page-size'] == '2'
    assert listing.select_one('select[name="tag"] option[value="9"]').get_text() == 'Public theme'
    assert not listing.select_one('option[value="10"]')
    assert listing.select_one('.reading-card img')['src'] == '/_gnosi-proof/current/sites/default/files/photo.png'
    assert any('Public listing summary' in card.get_text() for card in listing.select('.reading-card'))

    table_page = BeautifulSoup((output / 'ca/dissenys/index.html').read_text(), 'html.parser')
    controlled_table = table_page.select_one('[data-public-listing]')
    assert controlled_table['data-page-size'] == '2'
    assert controlled_table.select_one('select[name="tag"] option[value="11"]').get_text() == 'Public design theme'
    assert controlled_table.select_one('[data-listing-pagination]')
    assert controlled_table.select_one('table th:nth-of-type(2)').get_text() == 'Material públic'
    rows = controlled_table.select('table tbody tr[data-listing-item]')
    assert len(rows) == 3
    assert all(json.loads(row['data-tags']) == ['11'] for row in rows)
    assert [row.select_one('td:nth-of-type(2)').get_text() for row in rows] == ['Public material 1', 'Public material 2', 'Public material 3']
    assert all(row.select_one('td a')['href'].startswith('/_gnosi-proof/current/ca/dissenys/') for row in rows)
    assert controlled_table.select_one('table th:nth-of-type(3)').get_text() == 'Accions'
    for row in rows:
        title_link = row.select_one('td:first-child a')
        show_link = row.select_one('td:nth-of-type(3) a.table-record-link')
        assert show_link['href'] == title_link['href']
        assert show_link.get_text() == 'Mostrar↗'
        assert show_link['aria-label'] == f'Mostrar: {title_link.get_text()}'
        assert show_link.select_one('span')['aria-hidden'] == 'true'
    assert 'private_internal' not in controlled_table.get_text()


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_resource_lists_link_to_each_entry_in_home_and_listing(imported_pilot, tmp_path):
    store, site, _, _ = imported_pilot
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    bundle['deployment_url'] = 'https://example.invalid/_gnosi-proof/current'
    output = tmp_path / 'public'
    render_bundle(bundle, output)
    checked = 0
    for path in output.rglob('*.html'):
        page = BeautifulSoup(path.read_text(), 'html.parser')
        lang = page.html.get('lang', 'en-gb')
        for row in page.select('.resource-list li'):
            title = row.select_one('.resource-title')
            action = row.select_one('a.table-record-link')
            caption = {'ca': 'Mostrar', 'es': 'Mostrar', 'fr': 'Afficher'}.get(lang, 'View')
            assert action['href'] == title['href']
            assert action.get_text() == caption + '↗'
            assert action['aria-label'] == caption + ': ' + title.get_text()
            assert action.select_one('[aria-hidden="true"]').get_text() == '↗'
            checked += 1
    assert checked >= 4  # Research and stories on both home and collection pages.


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_newsletter_privacy_links_follow_localized_footer_pages(imported_pilot, tmp_path):
    store, site, _, _ = imported_pilot
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    bundle['deployment_url'] = 'https://example.invalid/_gnosi-proof/current'
    policies = {
        'ca': ('Política de privacitat', '/ca/privacitat-configurada'),
        'es': ('Política de privacidad', '/es/privacidad-configurada'),
        'en-gb': ('Privacy Policy', '/en-gb/custom-privacy'),
        'fr': ('Politique de confidentialité', '/fr/confidentialite-configuree'),
    }
    bundle['site']['languages'] = list(policies)
    home = next(page for page in bundle['site']['pages'] if page['template'] == 'home')
    french_home = deepcopy(home)
    french_home.update(id='home-fr', language='fr', path='/fr')
    bundle['site']['pages'].append(french_home)
    bundle['site']['footer'] = []
    for language, (title, path) in policies.items():
        bundle['site']['footer'].append(dict(label=title, href=path, language=language))
        policy = deepcopy(home)
        policy.update(id='privacy-' + language, language=language, path=path, title=title, template='article', blocks=[])
        bundle['site']['pages'].append(policy)
    output = tmp_path / 'public'
    render_bundle(bundle, output)
    for language, (_, path) in policies.items():
        page = BeautifulSoup((output / language / 'index.html').read_text(), 'html.parser')
        label = page.select_one('.staging-subscription label.choice')
        link = label.select_one('a')
        assert link['href'] == '/_gnosi-proof/current' + path
        assert label.select_one('input[name="consent"][required]')
        assert (output / path.lstrip('/') / 'index.html').is_file()
