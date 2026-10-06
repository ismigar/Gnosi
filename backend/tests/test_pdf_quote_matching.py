"""Highlight entire evidence, including short quotes, without guessing occurrences."""
from backend.domains.llm_wiki.pdf_quote_matching import compact, unique_span, normalized_pdf_span
from backend.services.llm_wiki_pdf_annotations import _find_quote_position, _search_queries
from backend.tests.test_llm_wiki_pdf_annotations import _demo_pdf, _TEST_QUOTE


def test_short_quotes_are_not_discarded():
    assert _search_queries('2 Heb 11,8.') == ['2 Heb 11,8.']
    assert _search_queries('El') == ['El']


def test_no_match_for_shared_prefix_with_wrong_ending(tmp_path):
    assert _find_quote_position(_demo_pdf(tmp_path), 1, _TEST_QUOTE + ' invented ending') is None


def test_layout_whitespace_is_equivalent_but_words_and_accents_are_not():
    text = compact('Muchas definiciones de credos.\nLos poderosos milagros.')
    assert unique_span(text, 'Muchas de finiciones de credos.') == (0, 27)
    assert unique_span(text, 'Los po derosos milagros.') is not None
    assert unique_span(text, 'Muchas definitivas de credos.') is None
    assert unique_span(compact('Halík'), 'Halik') is None


def test_short_repeated_quote_needs_one_identifiable_original():
    text = compact('First claim. Shared caution. Second claim. Shared caution.')
    assert unique_span(text, 'Shared caution.') is None
    assert unique_span(text, 'Shared caution.', 'Second claim. Shared caution.') == (37, 51)


def test_native_character_indices_survive_pdfium_inserted_text():
    class Page:
        def count_chars(self):
            return 4
        def get_text_range(self, index=0, count=-1):
            return ['A', '\r\n', 'B', 'C'][index]
    assert normalized_pdf_span(Page(), 'A B C') == (0, 4)


def test_previously_guessed_highlight_is_removed_when_full_quote_cannot_be_verified(tmp_path):
    from backend.services.llm_wiki_pdf_annotations import sync_generated_pdf_annotations
    from backend.tests.test_llm_wiki_pdf_annotations import _session, _origin, _citation
    from backend.models.pdf_annotation import PdfAnnotation
    session = _session()
    pdf = _demo_pdf(tmp_path)
    citation = {**_citation(), 'quote': _TEST_QUOTE + ' invented ending'}
    notes = [{'citations': [citation]}]
    legacy_position = {'page_index': 0, 'rects': [[1, 1, 2, 2]], 'sort_index': '00000|000000|00000'}
    sync_generated_pdf_annotations(notes, [_origin(pdf)], 'book', session=session,
                                   position_resolver=lambda *args: legacy_position)
    report = sync_generated_pdf_annotations(notes, [_origin(pdf)], 'book', session=session)
    assert report['matched'] == 0 and report['removed'] == 1
    assert session.query(PdfAnnotation).count() == 0


def test_page_index_is_built_once_per_document_during_highlight_sync(tmp_path, monkeypatch):
    from backend.services import llm_wiki_pdf_annotations as annotations
    from backend.tests.test_llm_wiki_pdf_annotations import _session, _origin, _citation
    calls = []
    original = annotations.index_page
    def measured(page):
        calls.append(True)
        return original(page)
    monkeypatch.setattr(annotations, 'index_page', measured)
    pdf = _demo_pdf(tmp_path)
    quotes = [
        'Persistent cita tion highlights span multiple lines',
        'in this port able PDF fixture',
        'Persistent citation highlights span multiple lines invented ending',
    ]
    notes = [{'citations': [{**_citation(), 'quote': quote} for quote in quotes]}]
    for _ in range(2):
        report = annotations.sync_generated_pdf_annotations(notes, [_origin(pdf)], 'book', session=_session())
        assert report['matched'] == 2 and len(report['warnings']) == 1
    assert len(calls) == 2  # Fresh per-sync indexes cannot outlive changed PDF bytes.


def test_unknown_glyph_recovery_requires_full_page_agreement():
    from backend.domains.llm_wiki.pdf_quote_matching import PageTextIndex, reconcile_unknown_characters
    native = PageTextIndex('greco\ufffecatólicos', tuple(range(15)))
    recovered = reconcile_unknown_characters(native, 'greco-católicos')
    assert recovered.find('greco-católicos') == (0, 15)
    assert recovered.indices is native.indices
    assert reconcile_unknown_characters(native, 'greco-católicos altered') is native
    assert reconcile_unknown_characters(native, 'greco-católicas') is native
    assert reconcile_unknown_characters(native, 'greco\ufffdcatólicos') is native
    # A known, different character is never treated as an unknown glyph.
    different = PageTextIndex('grecocatólicos', tuple(range(14)))
    assert reconcile_unknown_characters(different, 'greco-católicos') is different


def test_unknown_native_glyph_uses_independent_page_text_not_requested_quote(tmp_path, monkeypatch):
    from backend.services import llm_wiki_pdf_annotations as annotations
    from backend.domains.llm_wiki.pdf_quote_matching import PageTextIndex
    index = annotations.index_page
    def unmapped(page):
        original = index(page)
        return PageTextIndex(original.text.replace('portable', 'p\ufffertable'), original.indices)
    monkeypatch.setattr(annotations, 'index_page', unmapped)
    pdf = _demo_pdf(tmp_path)
    assert annotations._find_quote_position(pdf, 1, 'in this port able PDF fixture') is not None
    assert annotations._find_quote_position(pdf, 1, 'in this part able PDF fixture') is None
