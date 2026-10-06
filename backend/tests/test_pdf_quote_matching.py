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
