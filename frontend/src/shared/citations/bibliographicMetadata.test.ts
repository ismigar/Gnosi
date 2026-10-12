import { readFileSync } from 'node:fs';
import CSL from 'citeproc';
import { describe, expect, it } from 'vitest';
import { bibliographicValues, cslDate } from './bibliographicMetadata';
import { recursosPageToCsl } from './cslItemMapper';

// Persisted field names and bibliographic examples. @language-example
const person = (nom: string, cognom1 = '', cognom2 = '') => ({ nom, cognom1, cognom2 });
const metadata = {
    'Citation Key': 'chapter', 'Item Type': 'bookSection',
    'Editors': [person('Joan', 'Puig')], 'Traductors': [person('Anna', 'Sol')],
    'Autoría': [person('Ada', 'García', 'Riu'), person('Research and Development Council')],
    'Any': 2024, 'Mes': 6, 'Dia': 12, 'Llibre/Revista': 'Collected studies',
    'Editorial': 'Press', 'Lloc': 'Barcelona', 'Pàgines': '12-28',
    'Data de consulta': '2025-02-28', 'Col·lecció': 'Studies',
};

describe('bibliographic roles and date precision', () => {
    it('keeps authors, editors and translators separate regardless of field order', () => {
        expect(recursosPageToCsl({ title: 'A chapter', metadata })).toMatchObject({
            author: [{ family: 'García Riu', given: 'Ada' }, { literal: 'Research and Development Council' }],
            editor: [{ family: 'Puig', given: 'Joan' }], translator: [{ family: 'Sol', given: 'Anna' }],
            issued: { 'date-parts': [[2024, 6, 12]] }, accessed: { 'date-parts': [[2025, 2, 28]] },
            'publisher-place': 'Barcelona', 'collection-title': 'Studies',
        });
    });
    it('never promotes editors to authors, including renamed fields', () => {
        const item = recursosPageToCsl({ title: 'An edited volume', metadata: {
            'Citation Key': 'edited', 'Item Type': 'book',
            'Scientific editors': [person('Joan', 'Puig')],
            '_citation_roles': { 'Scientific editors': 'editor' },
            'Traductors': [person('Anna', 'Sol')],
        } });
        expect(item?.author).toBeUndefined();
        expect(item?.editor).toEqual([{ family: 'Puig', given: 'Joan' }]);
        expect(item?.translator).toEqual([{ family: 'Sol', given: 'Anna' }]);
    });
    it('recovers old extras while respecting an explicitly cleared field', () => {
        const values = bibliographicValues({ 'Item Type': 'thesis', 'Institució': '', 'Zotero Extras': {
            university: 'UNED', thesisType: 'Doctoral thesis', accessDate: '2024-01-02',
        } });
        expect(values['Institució']).toBe('');
        expect(values['Tipus de document']).toBe('Doctoral thesis');
        expect(values['Data de consulta']).toBe('2024-01-02');
    });
    it.each([
        ['2024 May 15', { 'date-parts': [[2024, 5, 15]] }],
        ['May 2024', { 'date-parts': [[2024, 5]] }],
        ['2024-02-29', { 'date-parts': [[2024, 2, 29]] }],
        ['2023-02-29', { literal: '2023-02-29' }],
        ['in press', { literal: 'in press' }],
    ])('preserves bibliographic precision for %s', (raw, expected) => {
        expect(cslDate(raw)).toEqual(expected);
    });
    it('renders actual APA output with editor and translator labels', () => {
        const item = recursosPageToCsl({ title: 'A chapter', metadata });
        const engine = new CSL.Engine({
            retrieveItem: () => item,
            retrieveLocale: () => readFileSync('public/csl/locales/locales-en-US.xml', 'utf8'),
        }, readFileSync('public/csl/styles/apa.csl', 'utf8'), 'en-US');
        engine.updateItems(['chapter']);
        const bibliography = engine.makeBibliography();
        expect(bibliography).toBeTruthy();
        const html = bibliography ? bibliography[1].join('') : '';
        expect(html).toContain('García Riu');
        expect(html).toContain('Research and Development Council');
        expect(html).toMatch(/Puig.*Ed\./);
        expect(html).toMatch(/Sol.*Trans\./);
    });
});
