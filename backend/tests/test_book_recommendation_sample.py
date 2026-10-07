"""Offline book-selection checks; no model calls or private book material."""
from copy import deepcopy
from dataclasses import asdict
import json

import pytest

from backend.services.agent_work_samples import WORK_CASES, validate_work
from backend.services.public_evaluation_contract import passed


BOOK = next(case for case in WORK_CASES if case.id == 'book_map')


def answer():
    return {**deepcopy(BOOK.expected), 'summary': (
        'La proposta inicial defensava centralitzar les decisions i reduir les reunions [C01]. '
        'La comparació dels barris mostra que respondre més ràpidament no garanteix atendre totes '
        'les peticions. La revisió confirma dotze peticions sense resposta al Nord [C07]. '
        'L’autora rebutja la generalització d’en Pau sobre el fracàs de tots els projectes. '
        'La conclusió adopta coordinació comuna, veu local i revisió compartida [C12], sense '
        'demostrar una superioritat universal [C13]. El seguiment indica que encara queden dues '
        'discrepàncies pendents, un cop llegida la frase que continua en el fragment següent [C14, C15].'
    )}


def test_source_quotes_are_verbatim_and_identify_one_public_passage():
    for quote in BOOK.expected['literal_quotes']:
        assert BOOK.source.count(quote['quote']) == 1
        assert f"[{quote['source']}] {quote['quote']}" in BOOK.source.splitlines()
    encoded = json.dumps(answer(), ensure_ascii=False)
    assert validate_work(BOOK, encoded) and passed(asdict(BOOK), encoded)
    assert BOOK.requires_review  # Data checks do not certify prose meaning or language.


@pytest.mark.parametrize('defect', ['paraphrase', 'wrong_source', 'cutoff', 'foreign_word', 'changed_thesis', 'wrong_voice'])
def test_recommendation_sample_rejects_the_observed_classes_of_reading_defect(defect):
    data = answer()
    if defect == 'paraphrase':
        data['literal_quotes'][0]['quote'] = 'Hi havia dotze peticions pendents.'
    elif defect == 'wrong_source':
        data['literal_quotes'][0]['source'] = 'C03'
    elif defect == 'cutoff':
        data['remaining_disagreements'] = None
    elif defect == 'foreign_word':
        data['repaired_note'] = 'La conclusió conserva la veu 관점.'
    elif defect == 'changed_thesis':
        data['position_changed'] = False
    else:
        data['author_agrees'] = True
    encoded = json.dumps(data, ensure_ascii=False)
    assert not validate_work(BOOK, encoded)
    assert not passed(asdict(BOOK), encoded)  # Public and local validation agree.
