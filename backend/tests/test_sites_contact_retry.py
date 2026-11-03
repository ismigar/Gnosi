"""Actual public PHP controller preserves configured forms after validation errors."""
import json
import shutil
import sqlite3
import subprocess

import pytest
from bs4 import BeautifulSoup

from backend.domains.sites.paths import extension_root


@pytest.mark.skipif(shutil.which('php') is None, reason='PHP is required')
@pytest.mark.parametrize('language', ['fr', 'es'])
@pytest.mark.parametrize('json_response', [False, True])
@pytest.mark.parametrize('revision', [1, 2])
def test_contact_retry_keeps_translated_configuration_without_sending(tmp_path, language, json_response, revision):
    public = tmp_path / 'public'
    public.mkdir()
    captions = {'fr': ['Rouge', 'Bleu'], 'es': ['Rojo', 'Azul']}
    localized = {'fr': 'Texte français <script>', 'es': 'Texto español <script>'}
    options = {'red': {'fr': 'Rouge', 'es': 'Rojo'}, 'blue': {'fr': 'Bleu', 'es': 'Azul'}}
    fields = [
        {'id': 'email', 'type': 'email', 'required': True, 'label': localized, 'placeholder': localized, 'help': localized},
        *[{'id': kind, 'type': kind, 'label': localized, 'options': ['red', 'blue'], 'option_labels': options} for kind in ('select', 'radio')],
    ]
    form = {'id': 'support', 'revision': 1, 'enabled': True, 'title': localized, 'intro': localized,
            'fields': fields, 'privacy_text': localized, 'privacy_label': localized, 'privacy_link_label': localized,
            'privacy_url': '/privacy', 'require_privacy': True, 'newsletter_list': 'news', 'newsletter_label': localized,
            'submit_label': localized, 'required_message': {'fr': 'Vérifier', 'es': 'Revisar'},
            'failure_message': {'fr': 'Réessayer', 'es': 'Reintentar'}}
    root = extension_root()
    config = {'site_id': 'synthetic', 'public_base_url': 'https://example.invalid/_gnosi/current',
              'db_path': str(tmp_path / 'state.sqlite'), 'spool_path': str(tmp_path / 'spool'), 'test_mode': True,
              'library_path': str(root / 'server/library.php'), 'forms': [form]}
    path = tmp_path / 'config.json'
    path.write_text(json.dumps(config))
    request = {'form_id': 'support', 'revision': revision, 'language': language,
               'values': {'email': '', 'select': 'red', 'radio': 'blue'}, 'newsletter_opt_in': '1'}
    code = '''
    putenv('GNOSI_SITES_SERVICE_CONFIG='.$argv[1]);
    $_SERVER=['DOCUMENT_ROOT'=>$argv[2], 'REQUEST_METHOD'=>'POST', 'HTTP_ORIGIN'=>'https://example.invalid', 'HTTP_ACCEPT'=>$argv[3]];
    $_POST=json_decode($argv[4],true,32,JSON_THROW_ON_ERROR);
    require $argv[5];
    '''
    result = subprocess.run(['php', '-r', code, str(path), str(public), 'application/json' if json_response else 'text/html',
                             json.dumps(request), str(root / 'public/api/contact.php')], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stderr == ''
    message = form['required_message' if revision == 1 else 'failure_message'][language]
    if json_response:
        assert json.loads(result.stdout)['message'] == message
    else:
        soup = BeautifulSoup(result.stdout, 'html.parser')
        assert soup.select_one('[role=alert]').get_text() == message
        assert soup.select_one('h2').get_text() == localized[language]
        assert soup.select_one('input[type=email]')['placeholder'] == localized[language]
        help_id = soup.select_one('input[type=email]')['aria-describedby']
        assert soup.select_one('#' + help_id).get_text() == localized[language]
        choices = soup.select('select option[value]:not([value=""])')
        assert [option.get_text() for option in choices] == captions[language]
        assert [option['value'] for option in choices] == ['red', 'blue']
        assert soup.select_one('option[selected]')['value'] == 'red'
        radios = soup.select('input[type=radio]')
        assert [radio.parent.get_text() for radio in radios] == captions[language]
        assert soup.select_one('input[type=radio][checked]')['value'] == 'blue'
        assert soup.select_one('input[name=privacy]').parent.get_text().strip() == localized[language]
        assert soup.select_one('input[name=newsletter_opt_in][checked]').parent.get_text().strip() == localized[language]
        assert soup.select_one('a')['href'] == '/_gnosi/current/privacy'
        assert soup.select_one('a').get_text() == localized[language]
        assert soup.select_one('button').get_text() == localized[language]
        assert not soup.select('script')
    with sqlite3.connect(config['db_path']) as db:
        assert db.execute('SELECT count(*) FROM messages').fetchone()[0] == 0
        assert db.execute('SELECT count(*) FROM queue').fetchone()[0] == 0


@pytest.mark.skipif(shutil.which('php') is None, reason='PHP is required')
def test_retry_privacy_link_refuses_script_or_protocol_relative_urls():
    common = extension_root() / 'public/api/common.php'
    code = 'require $argv[1]; foreach (["javascript:alert(1)", "//evil.invalid", "/privacy", "https://example.org/privacy"] as $url) echo json_encode(site_public_contact_link($url,"https://site.invalid/base"))."\\n";'
    result = subprocess.run(['php', '-r', code, str(common)], capture_output=True, text=True, timeout=10, check=True)
    assert [json.loads(line) for line in result.stdout.splitlines()] == ['', '', '/base/privacy', 'https://example.org/privacy']


@pytest.mark.skipif(shutil.which('php') is None, reason='PHP is required')
def test_blank_or_missing_override_uses_language_default_without_another_language_caption():
    common = extension_root() / 'public/api/common.php'
    code = '''require $argv[1];
    foreach (['', null, 'Custom'] as $value) {
        $captions=['fr'=>'French']; if ($value !== null) $captions['es']=$value;
        echo json_encode(site_public_override($captions,'es','Spanish default'))."\\n";
    }'''
    result = subprocess.run(['php', '-r', code, str(common)], capture_output=True, text=True, timeout=10, check=True)
    assert [json.loads(line) for line in result.stdout.splitlines()] == ['Spanish default', 'Spanish default', 'Custom']
