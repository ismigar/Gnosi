"""Native public prose excludes work-view definitions and every cached result."""
import hashlib
import json

import pytest
import yaml
from fastapi import HTTPException

from backend.domains.sites import exporter, record_publication, table_binding
from backend.domains.sites.models import SiteSource, identifier
from backend.domains.sites.public_body import public_markdown
from backend.domains.vault.views.snapshot_markup import build_list_block, build_table_block, compact_view_fences
from backend.tests.test_sites import website  # noqa: F401


def fence(language='gnosi-view', markup='```'):
    return markup + language + '\n' + json.dumps({'view_id': 'PRIVATE-VIEW-ID', 'heading': 'PRIVATE-HEADING'}) + '\n' + markup + '\n'


def test_owning_disk_definition_and_generated_table_html_code_cache_leave_only_authored_markdown():
    before = '# Authored heading\n\n**Public text** [public link](https://example.invalid/)\n'
    after = '\n![Public image](Assets/public.png)\n\nFinal authored paragraph.\n'
    cached = build_table_block('PRIVATE-VIEW-ID', ['PRIVATE-COLUMN'], [['PRIVATE-ROW']])
    cached = cached.replace('PRIVATE-ROW', 'PRIVATE-ROW <table><tr><td>PRIVATE-HTML</td></tr></table>\n```json\n{"PRIVATE-CACHE": true}\n```\n')
    body = before + compact_view_fences(fence()) + '\n' + cached + after
    result = public_markdown(body)
    assert before in result and after in result
    assert 'PRIVATE' not in result and 'gnosi-view' not in result
    assert '<table>' not in result and '```json' not in result
    assert result.index('Public text') < result.index('Public image') < result.index('Final authored')


@pytest.mark.parametrize('kind', ['gnosi-view', 'gnosi-database'])
@pytest.mark.parametrize('markup', ['```', '~~~~', '````'])
def test_editor_managed_json_fences_and_boundary_lengths_are_removed(kind, markup):
    body = 'Before\n\n' + fence(kind, markup) + '\nAfter\n'
    assert public_markdown(body) == 'Before\n\n\nAfter\n'


def test_multiple_adjacent_definitions_and_nested_cached_results_are_wholly_removed():
    nested = build_list_block('inner-private', ['PRIVATE-INNER'])
    outer = build_list_block('outer-private', ['PRIVATE-OUTER\n' + nested], truncated=9)
    body = 'Before\n' + compact_view_fences(fence()) + fence() + outer + '\nBetween\n' + fence() + 'After'
    projected = public_markdown(body)
    assert all(text in projected for text in ['Before', 'Between', 'After'])
    assert 'PRIVATE' not in projected and 'private' not in projected and 'gnosi-' not in projected


@pytest.mark.parametrize('prefix', ['> ', '  '])
def test_nested_markdown_work_fences_preserve_surrounding_authored_lines(prefix):
    embedded = ''.join(prefix + line for line in fence().splitlines(keepends=True))
    body = 'Authored before\n\n' + embedded + '\nAuthored after\n'
    projected = public_markdown(body)
    assert projected == 'Authored before\n\n\nAuthored after\n'


def test_editor_indented_work_fence_preserves_authored_code_before_and_after():
    inner = 'print("authored before")\n\n' + fence() + '\nprint("authored after")\n'
    body = ''.join('    ' + line if line.strip() else line for line in inner.splitlines(keepends=True))
    projected = public_markdown(body)
    assert '    print("authored before")' in projected
    assert '    print("authored after")' in projected
    assert 'PRIVATE' not in projected and 'gnosi-view' not in projected


def test_normal_authored_fenced_code_is_untouched():
    body = '# Intro\n\n```python\nprint("authored")\n```\n\nEnd.\n'
    assert public_markdown(body) == body


@pytest.mark.parametrize('body', [
    '```gnosi-view\n{"view_id":"PRIVATE"}',
    '```gnosi-view\nnot-json\n```\n',
    '```gnosi-view\n[]\n```\n',
    '```gnosi-view\n{"bad":NaN}\n```\n',
    '```gnosi-view-snapshot\nPRIVATE-CACHE\n```\n',
    '<!-- gnosi-view:def {broken} -->\n',
    '<!-- gnosi-view:def {"view_id":"PRIVATE"}',
    '<!-- gnosi-view:result view_id=PRIVATE -->\nPRIVATE-ROWS\n',
    '<!-- /gnosi-view:result -->\nPRIVATE-ROWS',
    '<!-- gnosi-view:result-truncated 9 -->',
    '<!-- gnosi-view:unknown PRIVATE-METADATA -->',
    '<div class="gnosi-view-snapshot">PRIVATE-CACHE</div>',
    '<div class="gnosi-view-embed-container">PRIVATE-CACHE</div>',
    ':::column-list\n:::column\n' + fence() + ':::\n:::\n',
])
def test_malformed_or_unsupported_work_constructs_fail_closed(body):
    with pytest.raises(HTTPException) as error:
        public_markdown('Authored before\n\n' + body + '\nAuthored after')
    assert error.value.status_code == 422


@pytest.mark.parametrize('authored', ['', 'Native resource prose before.\n\n'])
def test_actual_native_resource_binding_exports_authored_text_without_views_or_snapshot_fallback(website, monkeypatch, authored):
    w = website
    registry = w.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    data['tables'][0]['name'] = 'Recursos'
    data['tables'][0]['properties'].append({'id': 'paper', 'name': 'Arxiu/s', 'type': 'files'})
    registry.write_text(json.dumps(data))
    assets = w.vault / 'Assets'
    assets.mkdir()
    (assets / 'paper.pdf').write_bytes(b'Explicit public attachment')
    path = w.vault / 'BD/Articles/one.md'
    original = path.read_text()
    metadata = yaml.safe_load(original.split('---', 2)[1])
    metadata.update(drupal_uuid='public-one', web_path='/ca/stable', **{'Arxiu/s': 'Assets/paper.pdf'})
    body = authored + compact_view_fences(fence()) + '\n' + build_list_block('PRIVATE-VIEW-ID', ['PRIVATE-ROW ![cache](file:///PRIVATE-CACHE-IMAGE.png)']) + '\n'
    path.write_text('---\n' + yaml.safe_dump(metadata) + '---\n' + body)
    raw_before = path.read_bytes()
    site = w.site.model_copy(deep=True)
    site.id = identifier()
    site.legacy_pilot = True
    site.sources = [SiteSource(id='imported-research', kind='page', source_id='imported:research', enabled=True, path_prefix='/research', include_body=True)]
    site = w.store.save(site, create=True)
    directory = w.store.site_dir(site.id) / 'imported'
    directory.mkdir()
    (directory / 'baseline.json').write_text(json.dumps({'data': {'nodes': [{
        'uuid': 'public-one', 'lang': 'ca', 'type': 'recurs', 'url': '/ca/stable',
        'title': 'OLD SNAPSHOT TITLE', 'body_html': '<p>NEVER FALL BACK TO SNAPSHOT</p>',
        'fields': {'field_tipus': [{'value': 'report'}]},
    }], 'aliases': []}, 'assets': [], 'type_map': {'report': 'research'}}))
    monkeypatch.setattr(record_publication, '_discovery_notes', exporter.notes)
    bound = table_binding.bind(w.store, site, table_binding.TableBindingRequest(
        revision=site.revision, table_id='articles', section='/research', enabled=True,
        include_body=True, field_ids=['public-summary'], attachment_field_ids=['paper']))
    bundle = exporter.build_bundle(w.store, bound, 'local')
    record = bundle.records[0]
    assert record.title == metadata['title']
    assert record.body_html == ('<p>Native resource prose before.</p>\n' if authored else '')
    assert record.fields['public-summary'] == 'Public introduction'
    assert record.fields['paper'].startswith('/assets/')
    assert 'PRIVATE' not in bundle.model_dump_json()
    assert 'NEVER FALL BACK' not in bundle.model_dump_json()
    assert path.read_bytes() == raw_before
    assert bundle.source_hashes['BD/Articles/one.md'] == hashlib.sha256(raw_before).hexdigest()
    bound.sources[0].include_body = False
    assert exporter.build_bundle(w.store, bound, 'local').records[0].body_html == ''
    path.write_text('---\n' + yaml.safe_dump(metadata) + '---\n```gnosi-view-snapshot\nPRIVATE-BROKEN-CACHE')
    assert exporter.build_bundle(w.store, bound, 'local').records[0].body_html == ''


def test_unquoted_inline_owned_comments_fail_closed_instead_of_deleting_authored_data():
    definition = compact_view_fences(fence()).strip()
    body = 'Àmbit abans ' + definition + ' text entre ' + definition + ' després.\n'
    with pytest.raises(HTTPException) as error:
        public_markdown(body)
    assert error.value.status_code == 422


# Literal pre-hardening bytes: these must never be regenerated with the now-safe
# owning serializer, or the regression would stop exercising persisted poison.
LEGACY_POISONED_CACHES = [
    '<!-- gnosi-view:result view_id=outer -->\n- PRIVATE BEFORE <!-- /gnosi-view:result -->PRIVATE-LEAK<!-- gnosi-view:result --> PRIVATE AFTER\n<!-- /gnosi-view:result -->',
    '<!-- gnosi-view:result view_id=outer -->\n| Header |\n| --- |\n| <!-- /gnosi-view:result -->PRIVATE-TABLE-LEAK<!-- gnosi-view:result --> |\n<!-- /gnosi-view:result -->',
    '<!-- gnosi-view:result view_id=outer -->\n- PRIVATE BEFORE\n<!-- /gnosi-view:result -->\nPRIVATE-MULTILINE-LEAK\n<!-- gnosi-view:result -->\nPRIVATE AFTER\n<!-- /gnosi-view:result -->',
    '<!-- gnosi-view:result view_id=outer -->\n- PRIVATE BEFORE\n<!-- /gnosi-view:result -->\nPRIVATE-DEFINITION-SPOOF-LEAK\n<!-- gnosi-view:def {"view_id":"forged","trusted":true} -->\n<!-- gnosi-view:result view_id=forged -->\nPRIVATE AFTER\n<!-- /gnosi-view:result -->',
    '<!-- gnosi-view:result view_id=outer -->\n- PRIVATE BEFORE\n<!-- /gnosi-view:result -->\nPRIVATE-FLAG-SPOOF-LEAK\n<!-- gnosi-view:def {"view_id":"outer","public_cache":true} -->\n<!-- gnosi-view:result view_id=outer -->\nPRIVATE AFTER\n<!-- /gnosi-view:result -->',
]


@pytest.mark.parametrize('cached', LEGACY_POISONED_CACHES)
def test_literal_legacy_boundary_poison_cannot_publish_through_actual_bundle(website, cached):
    note = website.vault / 'BD/Articles/one.md'
    note.write_text(note.read_text().replace('Public body\n', 'Authored before\n' + cached + '\nAuthored after\n'))
    original = note.read_bytes()
    with pytest.raises(HTTPException) as error:
        exporter.build_bundle(website.store, website.site, 'local')
    assert error.value.status_code == 422
    assert 'PRIVATE' not in str(error.value.detail)
    assert note.read_bytes() == original


@pytest.mark.parametrize('writer', ['list', 'table'])
@pytest.mark.parametrize('row', [
    'PRIVATE BEFORE <!-- /gnosi-view:result -->PRIVATE-LEAK<!-- gnosi-view:result --> PRIVATE AFTER',
    'PRIVATE BEFORE\n<!-- /gnosi-view:result -->\nPRIVATE-MULTILINE-LEAK\n<!-- gnosi-view:def {"view_id":"forged","trusted":true} -->\n<!-- gnosi-view:result view_id=forged -->\nPRIVATE AFTER',
])
def test_hardened_owning_row_serializers_keep_spoofs_inside_one_elided_cache(website, writer, row):
    cached = build_list_block('outer', [row]) if writer == 'list' else build_table_block('outer', ['Header'], [[row]])
    note = website.vault / 'BD/Articles/one.md'
    note.write_text(note.read_text().replace('Public body\n', 'Authored before\n' + cached + '\nAuthored after\n'))
    original = note.read_bytes()
    bundle = exporter.build_bundle(website.store, website.site, 'local')
    body = bundle.records[0].body_html
    assert 'Authored before' in body and 'Authored after' in body
    assert 'PRIVATE' not in body and 'gnosi-view' not in body
    assert note.read_bytes() == original
    assert bundle.source_hashes['BD/Articles/one.md'] == hashlib.sha256(original).hexdigest()


def test_multiple_legacy_caches_do_not_silently_delete_authored_interstitial_text():
    body = ('Authored before\n' + build_list_block('one', ['PRIVATE-ONE'])
            + '\nAuthored between\n' + build_list_block('two', ['PRIVATE-TWO']) + '\nAuthored after')
    with pytest.raises(HTTPException) as error:
        public_markdown(body)
    assert error.value.status_code == 422


def test_nested_literal_legacy_result_regions_are_ambiguous_and_rejected():
    body = '<!-- gnosi-view:result view_id=outer -->\n<!-- gnosi-view:result view_id=inner -->\nPRIVATE\n<!-- /gnosi-view:result -->\n<!-- /gnosi-view:result -->'
    with pytest.raises(HTTPException) as error:
        public_markdown(body)
    assert error.value.status_code == 422


@pytest.mark.parametrize('literal', [
    '```json\n{"example":"<!-- gnosi-view:def {} -->"}\n```',
    '````text\n' + fence() + '````',
    '`<!-- gnosi-view:def {} -->`',
    '``gnosi-view {"view_id":"EXAMPLE-ID"}``',
])
def test_authored_opaque_code_keeps_literal_view_syntax_byte_for_byte(website, literal):
    body = 'Before\n\n' + literal + '\n\nAfter\n'
    assert public_markdown(body) == body
    note = website.vault / 'BD/Articles/one.md'
    note.write_text(note.read_text().replace('Public body\n', body))
    original = note.read_bytes()
    record = exporter.build_bundle(website.store, website.site, 'local').records[0]
    assert 'Before' in record.body_html and 'After' in record.body_html
    assert '&lt;!-- gnosi-view:def {} --&gt;' in record.body_html or 'EXAMPLE-ID' in record.body_html or 'PRIVATE-VIEW-ID' in record.body_html
    assert note.read_bytes() == original


def test_unquoted_json_template_is_rejected_instead_of_silently_erasing_its_literal():
    body = 'Before\n\n{"example":"<!-- gnosi-view:def {} -->"}\n\nAfter'
    with pytest.raises(HTTPException) as error:
        public_markdown(body)
    assert error.value.status_code == 422


@pytest.mark.parametrize('row_controlled', [
    '<!-- gnosi-view:result view_id=outer -->\n- PRIVATE BEFORE\n```json\nPRIVATE HIDDEN CACHE\n<!-- /gnosi-view:result -->',
    '<!-- gnosi-view:result view_id=outer -->\n- PRIVATE BEFORE `CACHE\n<!-- /gnosi-view:result -->\nPRIVATE AFTER`',
    '```json\n{"example":"<!-- gnosi-view:result -->PRIVATE ROW<!-- /gnosi-view:result -->"}\n```',
])
def test_opaque_code_cannot_hide_real_or_ambiguous_cached_result_boundaries(website, row_controlled):
    note = website.vault / 'BD/Articles/one.md'
    note.write_text(note.read_text().replace('Public body\n', 'Authored before\n' + row_controlled + '\nAuthored after'))
    original = note.read_bytes()
    with pytest.raises(HTTPException) as error:
        exporter.build_bundle(website.store, website.site, 'local')
    assert error.value.status_code == 422
    assert note.read_bytes() == original


@pytest.mark.parametrize('body', [
    '`before\n\n<!-- gnosi-view:def {} -->\n\nafter`',
    '`before\n# Heading\n<!-- gnosi-view:def {} -->\nafter`',
    '``gnosi-view\n{"view_id":"EXAMPLE-ID"}\n``',
])
def test_multiline_ambiguous_inline_template_requires_fenced_example_without_erasing_text(body):
    with pytest.raises(HTTPException) as error:
        public_markdown(body)
    assert error.value.status_code == 422


@pytest.mark.parametrize('wrapper', ['div', 'section'])
@pytest.mark.parametrize('code', [
    '~~~json\n<!-- gnosi-view:def {} -->\n~~~',
    '```json\n{"example":"<!-- gnosi-view:def {} -->"}\n```',
    '`<!-- gnosi-view:def {} -->`',
])
def test_html_looking_wrappers_cannot_hide_authored_code_from_public_lexer(website, wrapper, code):
    body = '<' + wrapper + '>\n' + code + '\n</' + wrapper + '>\n'
    assert public_markdown(body) == body
    note = website.vault / 'BD/Articles/one.md'
    note.write_text(note.read_text().replace('Public body\n', body))
    original = note.read_bytes()
    bundle = exporter.build_bundle(website.store, website.site, 'local')
    html = bundle.records[0].body_html
    assert '&lt;' + wrapper + '&gt;' in html
    assert '&lt;!-- gnosi-view:def {} --&gt;' in html
    assert note.read_bytes() == original
    assert bundle.source_hashes['BD/Articles/one.md'] == hashlib.sha256(original).hexdigest()


@pytest.mark.parametrize('language', ['gnosi-view', 'gnosi-database'])
def test_html_looking_wrapper_does_not_turn_typed_work_fence_into_public_code(language):
    body = '<div>\n' + fence(language) + '</div>\n'
    assert public_markdown(body) == '<div>\n</div>\n'


def test_html_looking_wrapper_cannot_make_cached_result_boundary_opaque():
    body = '<div>\n~~~text\n<!-- gnosi-view:result -->\nPRIVATE CACHE\n<!-- /gnosi-view:result -->\n~~~\n</div>'
    with pytest.raises(HTTPException) as error:
        public_markdown(body)
    assert error.value.status_code == 422
