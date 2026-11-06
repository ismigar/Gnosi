"""Imported routes and configured contact captions render for a non-pilot website."""
import pytest
from bs4 import BeautifulSoup

from backend.domains.sites.exporter import build_bundle
from backend.domains.sites.models import FormField, SiteBlock, SiteConfig, SiteForm, SitePage
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
                    privacy_link_label={'fr': 'Notre politique', 'en': 'Our policy'})
    for field_type in ('select', 'radio'):
        form.fields.append(FormField(id=field_type, type=field_type, options=['red', 'blue'],
                                     option_labels={'red': {'fr': 'Rouge', 'en': 'Red', 'es': ''}, 'blue': {'fr': 'Bleu', 'en': 'Blue'}}))
    for name in ('privacy_link_label', 'privacy_label', 'newsletter_label', 'required_message', 'failure_message', 'submit_label'):
        getattr(form, name)['es'] = ''
    site = SiteConfig(name='Independent', origin='https://source.example.org', languages=['fr', 'en', 'es'], default_language='fr', forms=[form], pages=[
        SitePage(title='Accueil', path='/', language='fr', enabled=True, blocks=[SiteBlock(body='[Local](https://source.example.org/about)\n\n[Original](https://source.example.org/not-imported)')]),
        SitePage(title='About', path='/about', language='en', enabled=True, blocks=[SiteBlock(type='form', form_id='support')]),
        SitePage(title='Contact', path='/contact', language='fr', enabled=True, blocks=[SiteBlock(type='form', form_id='support')]),
        SitePage(title='Contacto', path='/contacto', language='es', enabled=True, blocks=[SiteBlock(type='form', form_id='support')]),
    ])
    site.targets[0].enabled = True
    bundle = build_bundle(store, site, 'local').model_dump(mode='json')
    bundle['deployment_url'] = 'https://staging.example.org/_gnosi-general/current'
    output = tmp_path / 'public'
    render_bundle(bundle, output)
    home = BeautifulSoup((output / 'index.html').read_text(), 'html.parser')
    assert home.select_one('.brand')['href'] == '/_gnosi-general/current/'
    assert home.select_one('.header-tools a[lang=en]')['href'] == '/_gnosi-general/current/about'
    links = {link.get_text(): link['href'] for link in home.select('.record-body a')}
    assert links['Local'] == '/_gnosi-general/current/about'
    assert links['Original'] == 'https://source.example.org/not-imported'
    assert 'Temenos Ismael' not in home.get_text()
    contact = BeautifulSoup((output / 'contact/index.html').read_text(), 'html.parser')
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
    fallback = BeautifulSoup((output / 'contacto/index.html').read_text(), 'html.parser')
    assert [option.get_text() for option in fallback.select('select option[value]:not([value=""])')] == ['red', 'blue']
    assert [radio.parent.get_text() for radio in fallback.select('input[type=radio]')] == ['red', 'blue']
    assert fallback.select_one('input[name=privacy]').parent.get_text() == 'Acepto el texto de privacidad'
    assert fallback.select_one('input[name=newsletter_opt_in]').parent.get_text() == 'Suscribirme al boletín'
    assert fallback.select_one('a[href$="/privacy"]').get_text() == 'Acepto el texto de privacidad'
    assert fallback.select_one('form[data-contact]')['data-invalid'] == 'Revisa los campos indicados.'
    assert fallback.select_one('form[data-contact]')['data-failure'].startswith('No se ha podido enviar.')
    assert fallback.select_one('form[data-contact] button[type=submit]').get_text() == 'Enviar'
