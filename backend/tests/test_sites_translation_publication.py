"""Native table translation subitems use reviewed selections without publishing."""
import json

import pytest
import yaml
from bs4 import BeautifulSoup

from backend.domains.sites import exporter, publication, record_publication, runtime
from backend.domains.sites.models import SitePage, SiteSource, identifier
from backend.tests.test_sites import website  # noqa: F401
from backend.tests.test_sites_incremental_preview import documents, render
from backend.tests.test_sites_incremental_preview import pytestmark as pytestmark
from backend.tests.test_sites_translation_incremental import keys


@pytest.mark.parametrize('mode', ['selected', 'all'])
@pytest.mark.parametrize('legacy', [False, True])
def test_native_translation_subitem_review_preserves_original_and_other_languages(website, monkeypatch, tmp_path, mode, legacy):
    w = website
    site = w.site.model_copy(deep=True)
    site.id = identifier()
    site.legacy_pilot = legacy
    site.languages = ['ca', 'es', 'fr']
    site.pages = [SitePage(id='home-' + lang, language=lang, path='/' + lang, title='Home', enabled=True) for lang in site.languages]
    site.sources = [SiteSource(id='native', kind='table', source_id='articles', enabled=True, include_body=True,
        selection_mode=mode, page_ids=['one', 'one-fr', 'unrelated'] if mode == 'selected' else [],
        withdrawn_ids=['one-es'], filters=[{'field_id': 'status', 'value': 'published'}], path_prefix='/articles')]
    site = w.store.save(site, create=True)
    if legacy:
        baseline = w.store.site_dir(site.id) / 'imported/baseline.json'
        baseline.parent.mkdir()
        baseline.write_text(json.dumps({'data': {'nodes': []}, 'assets': [], 'type_map': {}}))
    original = {'id': 'one', 'table_id': 'articles', 'title': 'Original', 'Idioma': 'ca', 'Status': 'published',
                'Private': 'NEVER-PUBLISH-SECRET', 'web_path': '/ca/original'}
    if legacy:
        original['drupal_uuid'] = 'public-one'
    notes = [original, {'id': 'unrelated', 'table_id': 'articles', 'title': 'Unrelated', 'Idioma': 'ca', 'Status': 'published', 'web_path': '/ca/unrelated'}]
    for lang in ['es', 'fr']:
        notes.append({'id': 'one-' + lang, 'title': 'Translation ' + lang, 'Status': 'published',
            'table_id': 'articles', 'database_table_id': 'articles', 'parent_id': 'one',
            'translation_origin_id': 'one', 'translation_lang': lang, 'translation_source_lang': 'ca',
            'Private': 'NEVER-PUBLISH-SECRET', 'web_path': '/' + lang + '/translation'})
    for note in notes:
        folder = w.vault / 'BD/Articles'
        if note.get('parent_id'):
            folder /= 'Original subitems'
            folder.mkdir(exist_ok=True)
        (folder / (note['id'] + '.md')).write_text('---\n' + yaml.safe_dump(note) + '---\nPublic body ' + note['title'])
    assert record_publication._context(w.store, 'one-es')[3] == 'articles'
    monkeypatch.setattr(runtime, 'start_server', lambda *args, **kwargs: 'http://127.0.0.1:49999')
    monkeypatch.setattr(publication, 'dispatch', lambda *args: pytest.fail('Review dispatched publication'))
    active = [exporter.build_bundle(w.store, site, 'local').model_dump(mode='json')]
    monkeypatch.setattr(w.store, 'active_bundle', lambda *_: active[0])
    original_id = 'public-one' if legacy else 'one'
    retained = {(original_id, 'ca'), ('one-fr', 'fr'), ('unrelated', 'ca')}
    assert {(r['id'], r['language']) for r in active[0]['records']} == retained
    cache_root = w.store.site_dir(site.id) / 'render-cache/local'
    first = {**active[0], 'deployment_url': 'http://127.0.0.1:49999', 'deployment_environment': 'staging'}
    render(first, tmp_path / 'initial', cache_root)
    previous_keys = keys(cache_root)
    # The old site can acquire aliases when this translation is first published.
    site = w.store.save(site.model_copy(update={'redirects': {
        '/es/node/123': '/es/translation', '/translation-es': '/es/translation'}}))
    for step, action in enumerate(['publish', 'withdraw', 'publish']):
        request = record_publication.RecordPublicationReview(page_id='one-es', target_id='local', action=action)
        candidate = record_publication.proposal(w.store, site, request)
        before = w.store.config_path(site.id).read_bytes()
        preview = record_publication.review(w.store, site, request)
        assert w.store.config_path(site.id).read_bytes() == before
        with w.store.database() as db:
            payload = json.loads(db.execute('SELECT payload FROM previews WHERE id=?', (preview.id,)).fetchone()['payload'])
            assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0
            assert db.execute('SELECT COUNT(*) FROM releases').fetchone()[0] == 0
        assert payload['record_proposal']['site'] == candidate.model_dump(mode='json')
        bundle = payload['bundle']
        identities = {(record['id'], record['language']) for record in bundle['records']}
        assert retained <= identities
        assert (('one-es', 'es') in identities) == (action == 'publish')
        assert {record['translation_id'] for record in bundle['records'] if record['id'] != 'unrelated'} == {original_id}
        assert 'NEVER-PUBLISH' not in json.dumps(bundle)
        assert candidate.sources[0].selection_mode == mode
        assert ('one-es' in candidate.sources[0].withdrawn_ids) == (action == 'withdraw')
        assert ('one-es' in candidate.sources[0].page_ids) == (mode == 'selected')
        current_keys = keys(cache_root)
        assert current_keys['/ca/unrelated'] == previous_keys['/ca/unrelated']
        assert current_keys['/ca/original'] != previous_keys['/ca/original']
        output = w.store.site_dir(site.id) / 'previews' / preview.id / 'public'
        stats = next(json.loads(line)['incremental'] for line in (output.parent / 'public.build.log').read_text().splitlines() if line.startswith('{"incremental":'))
        assert stats['reused'] > 0 and stats['rendered'] < len(current_keys)
        html = BeautifulSoup((output / 'ca/original/index.html').read_text(), 'html.parser')
        assert bool(html.select('link[hreflang="es"]')) == (action == 'publish')
        assert html.select_one('link[hreflang="fr"]')['href'].endswith('/fr/translation')
        assert (output / 'es/translation/index.html').exists() == (action == 'publish')
        assert (output / 'es/node/123/index.html').exists() == (action == 'publish')
        assert (output / 'translation-es/index.html').exists() == (action == 'publish')
        render({**bundle, 'deployment_url': 'http://127.0.0.1:49999', 'deployment_environment': 'staging'}, tmp_path / ('full-' + str(step)), None)
        assert documents(output) == documents(tmp_path / ('full-' + str(step)))
        active[0] = bundle  # Synthetic installed reference; no release or activation is performed.
        previous_keys = current_keys
        site = w.store.save(candidate.model_copy(update={'revision': site.revision}))
