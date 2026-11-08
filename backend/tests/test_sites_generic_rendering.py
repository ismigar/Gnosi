"""Imported routes and configured contact captions render for a non-pilot website."""
import pytest
from bs4 import BeautifulSoup

from backend.domains.sites.exporter import build_bundle
from backend.domains.sites.models import FormField, NavigationLink, SiteBlock, SiteConfig, SiteForm, SitePage
from backend.domains.sites.paths import extension_root
from backend.domains.sites.renderer import render_bundle
from backend.domains.sites.storage import SiteStore
from backend.services.workspace_service import WorkspaceContext


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_generic_original_routes_and_contact_texts_render_without_temenos_defaults(tmp_path, monkeypatch):
    vault = tmp_path / 'vault'
    vault.mkdir()
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path / 'device'))
    store = SiteStore(WorkspaceContext('workspace', 'owner', 'owner', vault))
    form = SiteForm(id='support', enabled=True, title={'fr': 'Assistance'}, require_privacy=True,
                    privacy_label={'fr': 'Je consens au traitement'}, newsletter_list='news',
                    newsletter_label={'fr': 'Recevoir nos nouvelles'}, required_message={'fr': 'À compléter'},
                    failure_message={'fr': 'Réessayez plus tard'}, privacy_url='/privacy',
                    privacy_link_label={'fr': 'Notre politique', 'en': 'Our policy'}, privacy_urls={'en': '/en/privacy'})
    for field_type in ('select', 'radio'):
        form.fields.append(FormField(id=field_type, type=field_type, options=['red', 'blue'],
                                     option_labels={'red': {'fr': 'Rouge', 'en': 'Red', 'es': ''}, 'blue': {'fr': 'Bleu', 'en': 'Blue'}}))
    for name in ('privacy_link_label', 'privacy_label', 'newsletter_label', 'required_message', 'failure_message', 'submit_label'):
        getattr(form, name)['es'] = ''
    site = SiteConfig(name='Independent', origin='https://source.example.org', languages=['fr', 'en', 'es'], default_language='fr', forms=[form],
                      newsletter_privacy_text={'fr': 'Responsable FR <script>not executable</script>', 'en': 'Controller EN'}, newsletter_names_required=False,
                      footer_blocks=[SiteBlock(type='newsletter')], pages=[
        SitePage(title='Accueil', path='/', language='fr', enabled=True, blocks=[SiteBlock(body='[Local](https://source.example.org/about)\n\n[Original](https://source.example.org/not-imported)'), SiteBlock(id='main-section', type='collection', title='Main section', heading_level=1, actions=[NavigationLink(label='View all', href='/about', appearance='outline')]), SiteBlock(id='normal-section', title='Normal section')]),
        SitePage(title='About', path='/about', language='en', enabled=True, blocks=[SiteBlock(type='form', form_id='support')]),
        SitePage(title='Contact', path='/contact', language='fr', enabled=True, blocks=[SiteBlock(type='form', form_id='support')]),
        SitePage(title='Contacto', path='/contacto', language='es', enabled=True, blocks=[SiteBlock(type='form', form_id='support')]),
        SitePage(title='Assistance', path='/assistance', language='fr', enabled=True, blocks=[SiteBlock(type='form', form_id='support')]),
    ])
    site.targets[0].enabled = True
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    bundle['deployment_url'] = 'https://staging.example.org/_gnosi-general/current'
    output = tmp_path / 'public'
    render_bundle(bundle, output)
    home = BeautifulSoup((output / 'index.html').read_text(), 'html.parser')
    assert home.select_one('[data-block-id=main-section] > h1').get_text() == 'Main section'
    action = home.select_one('[data-block-id=main-section] > .actions > a')
    assert action.get_text() == 'View all' and action['href'] == '/_gnosi-general/current/about'
    assert 'button-outline' in action['class']
    assert home.select_one('[data-block-id=normal-section] > h2').get_text() == 'Normal section'
    same = BeautifulSoup((output / 'assistance/index.html').read_text(), 'html.parser')
    assert len([heading for heading in same.select('main h1, main h2') if heading.get_text() == 'Assistance']) == 1
    for path, notice in [('contact', 'Responsable FR <script>not executable</script>'), ('about', 'Controller EN')]:
        rendered = BeautifulSoup((output / path / 'index.html').read_text(), 'html.parser')
        subscription = rendered.select_one('form.staging-subscription')
        assert subscription.select_one('.newsletter-privacy').get_text() == notice
        assert subscription.select_one('.newsletter-privacy script') is None
        nodes = list(subscription.descendants)
        assert nodes.index(subscription.select_one('.newsletter-privacy')) < nodes.index(subscription.select_one('input[name=consent]'))
        trap = subscription.select_one('input[name=website]')
        assert trap['tabindex'] == '-1' and trap.parent.parent['aria-hidden'] == 'true'
        assert not subscription.select_one('input[name=first_name]').has_attr('required')
        assert not subscription.select_one('input[name=last_name]').has_attr('required')
        assert subscription.select_one('input[name=email]').has_attr('required')
        assert subscription.select_one('input[name=consent]').has_attr('required')
    assert home.select_one('.brand')['href'] == '/_gnosi-general/current/'
    assert home.select_one('.header-tools a[lang=en]')['href'] == '/_gnosi-general/current/about'
    links = {link.get_text(): link['href'] for link in home.select('.record-body a')}
    assert links['Local'] == '/_gnosi-general/current/about'
    assert links['Original'] == 'https://source.example.org/not-imported'
    assert 'Temenos Ismael' not in home.get_text()
    contact = BeautifulSoup((output / 'contact/index.html').read_text(), 'html.parser')
    assert contact.select_one('main h1').get_text() == 'Contact'
    assert contact.select_one('main h2').get_text() == 'Assistance'
    control = contact.select_one('form[data-contact]')
    assert control['data-failure'] == 'Réessayez plus tard'
    assert control['data-invalid'] == 'À compléter'
    assert 'Je consens au traitement' in control.select_one('input[name=privacy]').parent.get_text()
    assert 'Recevoir nos nouvelles' in control.select_one('input[name=newsletter_opt_in]').parent.get_text()
    assert control.select_one('a[href$="/privacy"]').get_text() == 'Notre politique'
    for language, path, captions, privacy in [('fr', 'contact', ['Rouge', 'Bleu'], 'Notre politique'), ('en', 'about', ['Red', 'Blue'], 'Our policy')]:
        translated = BeautifulSoup((output / path / 'index.html').read_text(), 'html.parser')
        options = translated.select('select[name="values[select]"] option[value]:not([value=""])')
        assert [option['value'] for option in options] == ['red', 'blue']
        assert [option.get_text() for option in options] == captions
        radios = translated.select('input[type=radio]')
        assert [radio['value'] for radio in radios] == ['red', 'blue']
        assert [radio.parent.get_text() for radio in radios] == captions
        assert translated.select_one('a[href$="/privacy"]').get_text() == privacy
        assert translated.select_one('form[data-contact] a')['href'] == '/_gnosi-general/current/' + ('en/privacy' if language == 'en' else 'privacy')
    fallback = BeautifulSoup((output / 'contacto/index.html').read_text(), 'html.parser')
    assert [option.get_text() for option in fallback.select('select option[value]:not([value=""])')] == ['red', 'blue']
    assert [radio.parent.get_text() for radio in fallback.select('input[type=radio]')] == ['red', 'blue']
    assert fallback.select_one('input[name=privacy]').parent.get_text() == 'Acepto el texto de privacidad'
    assert fallback.select_one('input[name=newsletter_opt_in]').parent.get_text() == 'Suscribirme al boletín'
    assert fallback.select_one('a[href$="/privacy"]').get_text() == 'Acepto el texto de privacidad'
    assert fallback.select_one('form[data-contact]')['data-invalid'] == 'Revisa los campos indicados.'
    assert fallback.select_one('form[data-contact]')['data-failure'].startswith('No se ha podido enviar.')
    assert fallback.select_one('form[data-contact] button[type=submit]').get_text() == 'Enviar'


@pytest.mark.skipif(not (extension_root() / 'renderer/node_modules/node/bin/node').is_file(), reason='Pinned renderer required')
def test_editor_rows_render_rich_columns_and_scoped_css(tmp_path, monkeypatch):
    vault = tmp_path / 'vault'; vault.mkdir()
    monkeypatch.setenv('GNOSI_DATA_DIR', str(tmp_path / 'device'))
    store = SiteStore(WorkspaceContext('workspace', 'owner', 'owner', vault))
    row = SiteBlock(type='row', children=[SiteBlock(id='rich-column', body='**Formatted** text', css='p { color: red; }'), SiteBlock(type='text', body='<p>Second <em>column</em><script>bad()</script></p>', body_format='html')])
    site = SiteConfig(name='Rows', pages=[SitePage(title='Rows', path='/ca/rows', enabled=True, blocks=[row])])
    site.targets[0].enabled = True
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    output = tmp_path / 'public'; render_bundle(bundle, output)
    soup = BeautifulSoup((output / 'ca/rows/index.html').read_text(), 'html.parser')
    columns = soup.select('.editor-row > .editor-column')
    assert len(columns) == 2
    assert columns[0].select_one('strong').get_text() == 'Formatted'
    assert columns[1].select_one('em').get_text() == 'column'
    assert columns[1].select_one('script') is None
    assert '--row-columns:2' in soup.select_one('.editor-row')['style']
    assert '[data-block-id="rich-column"]' in soup.get_text() or any('[data-block-id="rich-column"]' in str(style) for style in soup.select('style'))
