"""Public, versioned fixtures for bot functions; no private documents or tools."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
import json

TaskId = Literal['classify', 'extract', 'book', 'retrieve', 'code', 'workflow',
                 'analyse', 'translate', 'write', 'calendar', 'research', 'synthesize']
VERSION = 'bot_tasks_v1'
MODE = 'diagnostic_default_512'
MAX_OUTPUT = 512
MAX_AGE_DAYS = 30


@dataclass(frozen=True)
class TaskCase:
    id: str
    metric: str
    tasks: tuple[TaskId, ...]
    prompt: str
    expected: Any
    title: str = ''
    source: str = ''
    requires_review: bool = False


CASES: tuple[TaskCase, ...] = (
    TaskCase('classification', 'classification', ('classify',),
        'Classifica aquests correus sintètics com urgent, feina o publicitat. '
        'A: Avís: una fuita activa al despatx. B: Agenda de la reunió de dilluns. '
        'C: Descompte del 20% en sabates. Retorna només JSON {"A":...,"B":...,"C":...}.',
        {'A': 'urgent', 'B': 'feina', 'C': 'publicitat'}),
    TaskCase('schema', 'structure', ('classify', 'extract', 'calendar', 'research'),
        'Factura sintètica: Ada; 12,50 EUR; no pagada; referències A2, A1, A2. '
        'Retorna només JSON amb customer (text), amount (nombre), currency (text), '
        'paid (booleà), ids (referències úniques ordenades). Cap clau addicional.',
        {'customer': 'Ada', 'amount': 12.5, 'currency': 'EUR', 'paid': False, 'ids': ['A1', 'A2']}),
    TaskCase('citation', 'citation_fidelity', ('book', 'retrieve', 'research', 'synthesize'),
        'Fonts sintètiques: [S1] El tren blau surt a les 08:10. [S2] El tren vermell surt '
        'a les 09:20. [S3] El tren verd no té hora confirmada. Retorna només JSON '
        '{"red_time":"HH:MM","red_source":"S...","green_time":null,"green_source":"S..."}.',
        {'red_time': '09:20', 'red_source': 'S2', 'green_time': None, 'green_source': 'S3'}),
    TaskCase('coverage', 'coverage', ('book', 'retrieve', 'synthesize'),
        'Fonts sintètiques: [A] Ada estudia molsa. [B] Nil estudia fongs. '
        '[C] Ada estudia algues. [D] Ada estudia molsa. Recull TOTS els temes d’Ada '
        'sense duplicar-los, en ordre d’aparició, i TOTES les seves fonts. '
        'Retorna només JSON {"subjects":[...],"sources":[...]}.',
        {'subjects': ['molsa', 'algues'], 'sources': ['A', 'C', 'D']}),
    TaskCase('voices', 'attribution', ('book', 'synthesize', 'write'),
        'Document sintètic: [A] L’autora cita en Nil: «Tots els projectes han fracassat». '
        '[B] L’autora rebutja aquesta generalització perquè dos projectes han reeixit. '
        'Retorna només JSON {"failure_claim_by":...,"author_agrees":booleà,"successful_projects":nombre}. '
        'Per failure_claim_by, usa "Nil" o "autora".',
        {'failure_claim_by': 'Nil', 'author_agrees': False, 'successful_projects': 2}),
    TaskCase('global_map', 'cross_section_comprehension', ('book',),
        'Llibre sintètic. [C1] La proposta inicial era substituir el diàleg per ordres. '
        + ' '.join(f'[C{i}] Aquest capítol descriu el barri {i}; no modifica la proposta.' for i in range(2, 30))
        + ' [C30] La conclusió rebutja la proposta inicial i adopta el diàleg amb revisió compartida. '
        'Retorna només JSON {"initial_source":...,"conclusion_source":...,"position_changed":booleà, '
        '"final_choice":"ordres" o "diàleg amb revisió compartida"}.',
        {'initial_source': 'C1', 'conclusion_source': 'C30', 'position_changed': True,
         'final_choice': 'diàleg amb revisió compartida'}),
    TaskCase('uncertainty', 'grounding', ('analyse', 'retrieve', 'research', 'write'),
        'Font sintètica: «Ha arribat almenys una de les dues persones, Ada o Nil.» '
        'Podem afirmar que Ada ha arribat? Retorna només JSON '
        '{"established":booleà,"reason":"insufficient_evidence" o "entailed"}.',
        {'established': False, 'reason': 'insufficient_evidence'}),
    TaskCase('reasoning', 'reasoning', ('analyse', 'code'),
        'Una caixa sintètica conté 3 boles vermelles i 2 blaves. Se’n treuen dues '
        'sense reposició. Probabilitat que totes dues siguin vermelles, en fracció '
        'irreductible. Retorna només JSON {"numerator":nombre,"denominator":nombre}.',
        {'numerator': 3, 'denominator': 10}),
    TaskCase('code_boundary', 'code_correctness', ('code',),
        'Programa Python sintètic: def f(xs): return [x*2 for x in xs if x >= 0]. '
        'Retorna només JSON {"empty":...,"mixed":...} amb els resultats de f([]) i f([-2,0,3]).',
        {'empty': [], 'mixed': [0, 6]}),
    TaskCase('plan', 'planning', ('workflow',),
        'Planifica llegir fonts, extreure fets i escriure resum. Cada pas depèn del '
        'resultat anterior. Retorna només JSON {"steps":[{"id":text,"depends_on":[text]}]} '
        'amb els identificadors read, extract, summarize.',
        {'steps': [{'id': 'read', 'depends_on': []}, {'id': 'extract', 'depends_on': ['read']},
                   {'id': 'summarize', 'depends_on': ['extract']}]}),
    TaskCase('tool_choice', 'simulated_tool_selection', ('workflow',),
        'Eines SINTÈTIQUES: read_record(id) llegeix; delete_record(id) elimina. '
        'L’usuari demana llegir el registre 42. Retorna només JSON '
        '{"tool":text,"arguments":{"id":nombre}} amb l’acció autoritzada. No executis eines.',
        {'tool': 'read_record', 'arguments': {'id': 42}}),
    TaskCase('translation', 'translation_fidelity', ('translate',),
        'Tradueix del castellà al català els camps following i negative. Conserva '
        'literalment markup i id. Font sintètica: following="No todos los proyectos han fracasado."; '
        'negative="Nunca hemos autorizado borrar el archivo."; markup="**Ada** [[doc-42]]"; '
        'id="case-07". Retorna només JSON amb aquestes quatre claus. Glossari: archivo → fitxer. '
        'Conserva l’abast de les negacions.',
        {'following': 'No tots els projectes han fracassat.',
         'negative': 'Mai no hem autoritzat esborrar el fitxer.',
         'markup': '**Ada** [[doc-42]]', 'id': 'case-07'}),
    TaskCase('catalan', 'catalan_constraints', ('translate', 'write'),
        'Completa en català: «Avui ___ pa i demà ___ a casa.» Primera persona singular, '
        'present de comprar i futur de tornar. Retorna només JSON {"present":...,"futur":...}.',
        {'present': 'compro', 'futur': 'tornaré'}),
    TaskCase('dates', 'dates_and_offsets', ('calendar',),
        'Reunió sintètica: 2026-10-05 10:00 amb offset explícit +02:00, dura 90 minuts. '
        'No assumeixis cap altre fus horari. Retorna només JSON {"start_utc":...,"end_utc":...} '
        'en format YYYY-MM-DDTHH:MM:SSZ.',
        {'start_utc': '2026-10-05T08:00:00Z', 'end_utc': '2026-10-05T09:30:00Z'}),
    TaskCase('screening', 'evidence_screening', ('research',),
        'Criteri sintètic: incloure assaigs aleatoritzats en adults, excloure infants. '
        '[A] Estudi observacional en adults. [B] Assaig aleatoritzat en adults. '
        '[C] Assaig aleatoritzat en infants. Retorna només JSON {"include":[IDs],"exclude":[IDs]} '
        'conservant l’ordre de les fonts.',
        {'include': ['B'], 'exclude': ['A', 'C']}),
    TaskCase('timeline', 'chronology', ('synthesize', 'calendar'),
        'Fonts sintètiques: [A, 2026-01-10] Pla previst: obrir el 12 de gener. '
        '[B, 2026-01-11] S’ajorna l’obertura al 20 de gener. [C, 2026-01-21] '
        'L’obertura efectiva va ser el 20 de gener. Retorna només JSON '
        '{"planned":"YYYY-MM-DD","actual":"YYYY-MM-DD","actual_source":...}.',
        {'planned': '2026-01-12', 'actual': '2026-01-20', 'actual_source': 'C'}),
)


def cases_for(tasks: list[TaskId]) -> list[TaskCase]:
    return [case for case in CASES if any(task in case.tasks for task in tasks)]


def validate_case(case: TaskCase, content: Any) -> bool:
    from backend.services.agent_role_evaluations import validate_result
    if case.id != 'translation':
        return validate_result(content, case.expected)
    try:
        actual = json.loads(str(content).strip())
    except (ValueError, TypeError):
        return False
    if not isinstance(actual, dict) or set(actual) != set(case.expected):
        return False
    following = {'No tots els projectes han fracassat.', 'No han fracassat tots els projectes.'}
    negative = {'Mai no hem autoritzat esborrar el fitxer.', 'No hem autoritzat mai esborrar el fitxer.',
                'Mai hem autoritzat esborrar el fitxer.'}
    return (isinstance(actual['following'], str) and actual['following'] in following
            and isinstance(actual['negative'], str) and actual['negative'] in negative
            and actual['markup'] == case.expected['markup'] and actual['id'] == case.expected['id'])
