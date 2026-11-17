"""Website builds read their source domain, never unrelated vault bodies."""
import json

import pytest
import yaml
from fastapi import HTTPException

from backend.domains.sites import exporter, publication, record_publication, source_inputs
from backend.tests.test_sites import website  # noqa: F401
from backend.tests.test_sites_record_publication import reviewed  # noqa: F401
from backend.tests.test_sites_table_binding import migration_site, request as binding_request
from backend.domains.sites import table_binding
from backend.domains.sites.models import SitePublishRequest, SiteSource


@pytest.mark.parametrize('action', ['publish', 'withdraw'])
@pytest.mark.parametrize('translated', [False, True])
def test_table_review_and_confirmation_never_read_unrelated_domains(reviewed, monkeypatch, action, translated):
    website, request = reviewed
    request.action = action
    if translated:
        website.site.languages = ['ca', 'es']
        website.site = website.store.save(website.site)
        (website.vault / 'BD/Articles/translated.md').write_text(
            '---\nid: translated\ntable_id: articles\nIdioma: es\ntranslation_of: one\nStatus: published\n---\nTranslation\n')
        request.page_id = 'translated'
    for folder in ['Mail', 'Contacts', 'Calendar/External', 'BD/Unrelated']:
        path = website.vault / folder / 'unavailable.md'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('---\nid: unrelated-' + folder + '\nprivate: true\n---\nPrivate content\n')
    original = exporter.bounded_read

    def read(path, root, maximum=4_000_000):
        if path.name == 'unavailable.md':
            pytest.fail('Publication tried to read an unrelated private body')
        return original(path, root, maximum)

    monkeypatch.setattr(exporter, 'bounded_read', read)
    preview = record_publication.review(website.store, website.site, request)
    assert publication.enqueue(website.store, website.site, SitePublishRequest(preview_id=preview.id)).status == 'queued'


def test_general_preview_never_reads_unrelated_domains(website, monkeypatch):
    path = website.vault / 'Mail/private.md'
    path.parent.mkdir()
    path.write_text('---\nid: private-mail\nprivate: true\n---\nPrivate\n')
    original = exporter.bounded_read

    def read(current, *args, **kwargs):
        assert current != path, 'Unrelated mail is not a website input'
        return original(current, *args, **kwargs)

    monkeypatch.setattr(exporter, 'bounded_read', read)
    bundle = exporter.build_bundle(website.store, website.site, 'local')
    assert [record.id for record in bundle.records] == ['one']


def test_new_relevant_note_is_discovered_without_cached_inventory(website):
    before = exporter.build_bundle(website.store, website.site, 'local')
    assert [record.id for record in before.records] == ['one']
    (website.vault / 'BD/Articles/new.md').write_text(
        '---\nid: new\ntable_id: articles\ntitle: New\nStatus: published\nIdioma: ca\n---\nNew body\n')
    after = exporter.build_bundle(website.store, website.site, 'local')
    assert {record.id for record in after.records} == {'one', 'new'}


def test_scoped_snapshot_cannot_be_reused_for_another_site(website):
    snapshot = exporter.source_snapshot(website.store, site=website.site)
    other = website.site.model_copy(update={'id': 'another-site'})
    with pytest.raises(HTTPException, match='snapshot'):
        exporter.build_bundle(website.store, other, 'local', snapshot=snapshot)


def test_unrelated_index_entries_do_not_trigger_even_a_source_stat(website, monkeypatch):
    from pathlib import Path
    private = website.vault / 'Mail/unavailable.md'
    entries = [{'path': str(private), 'metadata': {'id': 'unrelated', 'private': True}}]
    monkeypatch.setattr(source_inputs, 'available_entries', lambda vault: entries)
    original = Path.stat

    def stat(path, *args, **kwargs):
        assert path != private, 'Unrelated cloud files must not be probed'
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'stat', stat)
    assert [record.id for record in exporter.build_bundle(website.store, website.site, 'local').records] == ['one']


def test_legacy_off_folder_inventory_discovers_new_siblings_fresh(website, monkeypatch):
    legacy = website.vault / 'Legacy'
    legacy.mkdir()
    first = legacy / 'first.md'
    first.write_text('---\nid: legacy-first\ntable_id: articles\nStatus: published\nIdioma: ca\n---\nFirst\n')
    hints = [{'path': str(first), 'metadata': {'id': 'legacy-first', 'table_id': 'articles'}}]
    monkeypatch.setattr(source_inputs, 'available_entries', lambda vault: hints)
    assert {record.id for record in exporter.build_bundle(website.store, website.site, 'local').records} == {'one', 'legacy-first'}
    (legacy / 'new.md').write_text('---\nid: legacy-new\ntable_id: articles\nStatus: published\nIdioma: ca\n---\nNew\n')
    assert {record.id for record in exporter.build_bundle(website.store, website.site, 'local').records} == {'one', 'legacy-first', 'legacy-new'}


@pytest.mark.parametrize('replacement', ['private: true', 'id: replaced'])
def test_index_hints_never_authorize_cached_identity_or_privacy(website, monkeypatch, replacement):
    legacy = website.vault / 'Legacy'
    legacy.mkdir()
    path = legacy / 'external.md'
    metadata = 'id: external\ntable_id: articles\nStatus: published\nIdioma: ca\n'
    metadata = metadata.replace('id: external', replacement) if replacement.startswith('id:') else metadata + replacement + '\n'
    path.write_text('---\n' + metadata + '---\nPRIVATE-CACHED-HINT-MUST-NOT-PUBLISH\n')
    monkeypatch.setattr(source_inputs, 'available_entries', lambda vault: [
        {'path': str(path), 'metadata': {'id': 'external', 'table_id': 'articles', 'Status': 'published'}},
    ])
    website.site.sources[0].selection_mode = 'selected'
    website.site.sources[0].page_ids = ['external']
    if replacement.startswith('id:'):
        with pytest.raises(HTTPException, match='explicitly selected page'):
            exporter.build_bundle(website.store, website.site, 'local')
    else:
        assert exporter.build_bundle(website.store, website.site, 'local').records == []


def test_missing_table_directory_cannot_become_an_empty_success(website, monkeypatch):
    import shutil
    shutil.rmtree(website.vault / 'BD/Articles')
    monkeypatch.setattr(source_inputs, 'available_entries', lambda vault: None)
    with pytest.raises(HTTPException, match='table location is unavailable'):
        exporter.build_bundle(website.store, website.site, 'local')


def note(path, metadata, body="Body"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("---\n" + yaml.safe_dump(metadata) + "---\n" + body + "\n")


def add_table(website, table_id, folder):
    registry = website.vault / "BD/vault_db_registry.json"
    data = json.loads(registry.read_text())
    data["tables"].append({"id": table_id, "folder": folder, "properties": []})
    registry.write_text(json.dumps(data))


def legacy_bundle(website, site):
    data, digest = exporter.registry(website.store)
    return exporter.build_bundle(website.store, site, "local", snapshot=exporter.SourceSnapshot(
        website.vault.resolve(), data, digest, exporter.notes(website.store)))


def test_canonical_native_ancestor_in_other_table(website, monkeypatch):
    origin_id = "123e4567-e89b-12d3-a456-426614174000"
    origin = {"id": origin_id, "table_id": "origins", "title": "Original", "Idioma": "ca"}
    original_path = website.vault / "BD/Origins" / (origin_id + ".md")
    add_table(website, "origins", "BD/Origins")
    note(original_path, origin)
    note(website.vault / "BD/Articles/child.md", {
        "id": "child", "table_id": "articles", "Status": "published",
        "translation_origin_id": origin_id.replace("-", "").upper(),
        "translation_lang": "es", "translation_source_lang": "ca",
    })
    website.site.languages = ["ca", "es"]
    monkeypatch.setattr(source_inputs, "available_entries", lambda _: [
        {"path": str(original_path), "metadata": origin}])
    baseline = legacy_bundle(website, website.site)
    assert next(r.translation_id for r in baseline.records if r.id == "child") == origin_id
    result = exporter.build_bundle(website.store, website.site, "local")
    assert next(r.translation_id for r in result.records if r.id == "child") == origin_id


def test_cold_direct_page_in_native_subitems(website, monkeypatch):
    path = website.vault / "BD/Articles/Original subitems/child.md"
    note(path, {"id": "child", "table_id": "articles", "Idioma": "ca", "title": "Child"})
    site = website.site.model_copy(deep=True)
    site.sources = [SiteSource(id="direct", kind="page", source_id="child", enabled=True)]
    monkeypatch.setattr(source_inputs, "available_entries", lambda _: None)
    assert [r.id for r in legacy_bundle(website, site).records] == ["child"]
    assert [r.id for r in exporter.build_bundle(website.store, site, "local").records] == ["child"]


def test_stale_hint_cannot_expand_to_private_mail_siblings(website, monkeypatch):
    path = website.vault / "Mail/former-article.md"
    secret = website.vault / "Mail/Nested/unavailable.md"
    note(path, {"id": "moved", "table_id": "contacts", "private": True})
    note(secret, {"id": "private-mail", "private": True}, "PRIVATE BODY")
    monkeypatch.setattr(source_inputs, "available_entries", lambda _: [
        {"path": str(path), "metadata": {"id": "moved", "table_id": "articles"}}])
    original = exporter.bounded_read

    def read(current, *args, **kwargs):
        assert current != secret, "Stale table hint expanded into unrelated private Mail body"
        return original(current, *args, **kwargs)

    monkeypatch.setattr(exporter, "bounded_read", read)
    assert [r.id for r in exporter.build_bundle(website.store, website.site, "local").records] == ["one"]


def test_canonical_native_child_hint_infers_original_language(website, monkeypatch):
    origin_id = "123e4567-e89b-12d3-a456-426614174000"
    origin = {"id": origin_id, "title": "Original"}
    original_path = website.vault / "BD/Origins" / (origin_id + ".md")
    child = {"id": "child", "translation_origin_id": origin_id.replace("-", "").upper(),
             "translation_lang": "es", "translation_source_lang": "en"}
    child_path = website.vault / "BD/Translations/child.md"
    add_table(website, "origins", "BD/Origins")
    add_table(website, "translations", "BD/Translations")
    note(original_path, origin)
    note(child_path, child)
    site = website.site.model_copy(deep=True)
    site.languages = ["ca", "es", "en-gb"]
    site.sources = [SiteSource(id="direct", kind="page", source_id=origin_id, enabled=True)]
    monkeypatch.setattr(source_inputs, "available_entries", lambda _: [
        {"path": str(original_path), "metadata": origin},
        {"path": str(child_path), "metadata": child},
    ])
    assert legacy_bundle(website, site).records[0].language == "en-gb"
    assert exporter.build_bundle(website.store, site, "local").records[0].language == "en-gb"


def test_cold_direct_original_keeps_nested_native_child_language_hint(website, monkeypatch):
    origin_id = "123e4567-e89b-12d3-a456-426614174000"
    parent = website.vault / "BD/Articles" / (origin_id + ".md")
    child = website.vault / "BD/Articles/Original subitems/child.md"
    child.parent.mkdir(parents=True)
    parent.write_text("---\n" + yaml.safe_dump({"id": origin_id, "title": "Original"}) + "---\nOriginal\n")
    child.write_text("---\n" + yaml.safe_dump({
        "id": "child", "translation_origin_id": origin_id,
        "translation_lang": "es", "translation_source_lang": "en",
    }) + "---\nTranslation\n")
    site = website.site.model_copy(deep=True)
    site.languages = ["ca", "es", "en-gb"]
    site.sources = [SiteSource(id="direct", kind="page", source_id=origin_id, enabled=True)]
    monkeypatch.setattr(source_inputs, "available_entries", lambda _: None)
    data, digest = exporter.registry(website.store)
    baseline = exporter.build_bundle(website.store, site, "local", snapshot=exporter.SourceSnapshot(
        website.vault.resolve(), data, digest, exporter.notes(website.store)))
    assert baseline.records[0].language == "en-gb"
    result = exporter.build_bundle(website.store, site, "local")
    assert result.records[0].language == "en-gb"


@pytest.mark.parametrize("direct", [True, False])
@pytest.mark.parametrize("canonical", [False, True])
def test_registered_private_table_under_bd_alias_is_pruned(website, monkeypatch, direct, canonical):
    registry = website.vault / "BD/vault_db_registry.json"
    data = json.loads(registry.read_text())
    if canonical:
        data["tables"][0]["folder"] = "BD/Articles"
    data["tables"].append({"id": "private-table", "folder": "BD/Articles/Private" if canonical else "Articles/Private", "web_publishable": False, "properties": []})
    registry.write_text(json.dumps(data))
    secret = website.vault / "BD/Articles/Private/secret.md"
    secret.parent.mkdir(parents=True)
    secret.write_text("---\n" + yaml.safe_dump({"id": "private-secret", "table_id": "private-table", "private": True}) + "---\nUnrelated private table body\n")
    site = website.site.model_copy(deep=True)
    if direct:
        site.sources = [SiteSource(id="direct", kind="page", source_id="one", enabled=True)]
    monkeypatch.setattr(source_inputs, "available_entries", lambda _: None)
    original = exporter.bounded_read

    def read(path, *args, **kwargs):
        assert path != secret, "Registered unrelated private table was not pruned under the BD alias"
        return original(path, *args, **kwargs)

    monkeypatch.setattr(exporter, "bounded_read", read)
    result = exporter.build_bundle(website.store, site, "local")
    assert [record.id for record in result.records] == ["one"]


def test_ambiguous_selected_bd_alias_never_reads_another_registered_table(website, monkeypatch):
    registry = website.vault / 'BD/vault_db_registry.json'
    data = json.loads(registry.read_text())
    data['tables'].append({'id': 'private-table', 'folder': 'BD/Articles', 'web_publishable': False})
    registry.write_text(json.dumps(data))
    original = exporter.bounded_read

    def read(path, *args, **kwargs):
        assert path.suffix != '.md', 'Conflicting table ownership must fail before reading bodies'
        return original(path, *args, **kwargs)

    monkeypatch.setattr(exporter, 'bounded_read', read)
    with pytest.raises(HTTPException, match='belongs to another registered table'):
        exporter.build_bundle(website.store, website.site, 'local')


@pytest.mark.parametrize('by_page', [False, True])
@pytest.mark.parametrize('cached', [False, True])
def test_menu_never_requests_unrelated_bodies(website, monkeypatch, isolated_validation_runtime, by_page, cached):
    from backend.api import vault_routes  # noqa: F401
    from backend.domains.vault.links import runtime as links
    notes = exporter.notes(website.store)
    unrelated = website.vault / 'Mail/unavailable.md'
    unrelated.parent.mkdir()
    unrelated.write_text('---\nid: private-mail\nprivate: true\n---\nPRIVATE\n')
    entries = [{'path': str(note.path), 'metadata': note.metadata} for note in notes]
    monkeypatch.setattr(source_inputs, 'available_entries', lambda vault: entries if cached else None)
    parsed = []
    def body(path):
        parsed.append(path)
        note = next((note for note in notes if note.path == path), None)
        return (note.metadata, note.body) if note else None
    monkeypatch.setattr(links, '_iter_docs_cache', {})
    monkeypatch.setattr(links._legacy.path_resolver, 'list_all_files', lambda vault: [note.path for note in notes] + [unrelated])
    monkeypatch.setattr(links, '_get_parsed_document', body)
    reads = []
    original = exporter.bounded_read
    def bounded(path, *args, **kwargs):
        if path.suffix == '.md': reads.append(path)
        assert path != unrelated
        return original(path, *args, **kwargs)
    monkeypatch.setattr(exporter, 'bounded_read', bounded)
    result = record_publication.destinations(website.store, **({'page_id':'one'} if by_page else {'table_id':'articles'}))
    assert [item.site_id for item in result] == [website.site.id]
    assert unrelated not in parsed, 'Opening the publication menu requested an unrelated private body'
    if cached: assert reads == [], 'Existing metadata inventory must not reread document bodies for a menu'


@pytest.mark.parametrize('inventory', ['missing', 'empty', 'partial'])
def test_missing_index_can_find_title_named_table_row(website, monkeypatch, isolated_validation_runtime, inventory):
    source = website.vault / 'BD/Articles/one.md'
    source.rename(source.with_name('First article.md'))
    entries = None if inventory == 'missing' else [] if inventory == 'empty' else [
        {'path': str(website.vault / 'BD/Articles/two.md'), 'metadata': {'id': 'two', 'table_id': 'articles'}},
    ]
    monkeypatch.setattr(source_inputs, 'available_entries', lambda _: entries)
    result = record_publication.destinations(website.store, page_id='one')
    assert [entry.site_id for entry in result] == [website.site.id]


def test_imported_table_binding_without_index_preserves_existing_publication(website, monkeypatch, isolated_validation_runtime):
    discover = record_publication._discovery_notes
    site = migration_site(website, monkeypatch, '/ca/existing-publication', '/ca/existing-publication')
    # The shared fixture normally stubs this caller and hides a return-type regression.
    monkeypatch.setattr(record_publication, '_discovery_notes', discover)
    monkeypatch.setattr(source_inputs, 'available_entries', lambda _: None)
    result = table_binding.bind(website.store, site, binding_request(website))
    assert result.sources[0].source_id == 'articles'
    assert result.sources[0].page_ids == ['one']


@pytest.mark.parametrize('folder', ['BD/Articles', 'Wiki/Pages'])
def test_cold_title_named_direct_page_uses_headers_without_unrelated_bodies(website, monkeypatch, folder):
    original = website.vault / 'BD/Articles/one.md'
    selected = website.vault / folder / 'Article title.md'
    selected.parent.mkdir(parents=True, exist_ok=True)
    original.rename(selected)
    selected.write_text(selected.read_text().replace('---\nid: one', '---\nsummary: |\n  ---\nid: one', 1))
    (selected.parent / '000-unrelated-link.md').symlink_to(selected)
    private = website.vault / 'Mail/private.md'
    note(private, {'id': 'private-mail', 'private': True}, 'PRIVATE-BODY')
    website.site.sources = [SiteSource(id='direct', kind='page', source_id='one', enabled=True)]
    monkeypatch.setattr(source_inputs, 'available_entries', lambda _: None)
    original_read = exporter.bounded_read

    def read(path, *args, **kwargs):
        assert path != private, 'Cold identity lookup read an unrelated body'
        return original_read(path, *args, **kwargs)

    monkeypatch.setattr(exporter, 'bounded_read', read)
    assert [record.id for record in exporter.build_bundle(website.store, website.site, 'local').records] == ['one']
    selected.write_text(selected.read_text().replace('id: one', 'id: one\nprivate: true'))
    assert exporter.build_bundle(website.store, website.site, 'local').records == []


@pytest.mark.parametrize('warm', [False, True])
def test_unregistered_direct_page_keeps_fresh_native_child_language_hint(website, monkeypatch, warm):
    origin = {'id': 'wiki-original', 'title': 'Original'}
    path = website.vault / 'Wiki/Original title.md'
    child = website.vault / 'Wiki/Original subitems/Translated title.md'
    note(path, origin)
    note(child, {'id': 'wiki-child', 'translation_origin_id': 'wiki-original',
                 'translation_lang': 'es', 'translation_source_lang': 'en'})
    site = website.site.model_copy(deep=True)
    site.languages = ['ca', 'en-gb', 'es']
    site.sources = [SiteSource(id='direct', kind='page', source_id='wiki-original', enabled=True)]
    hints = [{'path': str(path), 'metadata': origin}] if warm else None
    monkeypatch.setattr(source_inputs, 'available_entries', lambda _: hints)
    assert legacy_bundle(website, site).records[0].language == 'en-gb'
    assert exporter.build_bundle(website.store, site, 'local').records[0].language == 'en-gb'


def test_missing_selected_table_row_never_scans_unrelated_headers(website, monkeypatch):
    website.site.sources[0].selection_mode = 'selected'
    website.site.sources[0].page_ids = ['deleted-row']
    monkeypatch.setattr(source_inputs, 'available_entries', lambda _: None)
    from backend.domains.sites import asset_files
    monkeypatch.setattr(asset_files, 'bounded_frontmatter', lambda *a: pytest.fail('Missing table row broadened locator scope'))
    with pytest.raises(HTTPException, match='explicitly selected page'):
        exporter.build_bundle(website.store, website.site, 'local')


def test_unconfigured_locator_never_bootstraps_application_api(website, monkeypatch):
    import builtins
    from backend.domains.vault.pages import index_service
    from backend.services.context_vars import active_vault_path
    original = builtins.__import__
    def restricted(name, *args, **kwargs):
        assert name != 'backend.api', 'Reading optional locator metadata must not initialize the application'
        return original(name, *args, **kwargs)
    monkeypatch.setattr(index_service, '_dependencies', None)
    monkeypatch.setattr(builtins, '__import__', restricted)
    prior = active_vault_path.get()
    assert source_inputs.available_entries(website.vault) is None
    assert active_vault_path.get() == prior
