import { describe, expect, it } from 'vitest';
import { pageReferenceId, pageReferenceTitle, readablePageTitle, readablePageTitleIndex } from './pageReferenceTitle';

const id = '9c05e9c1-dd54-470f-bac9-ff59cbd70bd4';
const area = 'd183c9c7-8177-5376-b8f0-f448f9837123';
const index = { [id]: 'Desde el reino de los sueños', [area]: 'Filosofia i espiritualitat' };

describe('page reference labels', () => {
    it.each([id, `/vault/page/${id}`, `/@principal/knowledge/page/${id}`,
        `/api/vault/pages/${id}`, `/api/v1/vaults/principal/knowledge/pages/${id}`,
        `gnosi-cite:?res=${id}&page=7`, `https://gnosi-cite.local/?res=${id}&page=7`,
        `[[${id}|Old title]]`, `[[Old title|${id}]]`])('resolves %s without changing its ID', ref => {
        expect(pageReferenceId(ref)).toBe(id);
        expect(pageReferenceTitle(ref, index)).toBe(index[id]);
    });
    it('resolves embedded identifiers in generated index titles', () => {
        expect(readablePageTitle(`Índex · Àrea: ${area}`, index)).toBe('Índex · Àrea: Filosofia i espiritualitat');
        expect(readablePageTitleIndex({ ...index, derived: `Índex · Àrea: ${area}` }).derived)
            .toBe('Índex · Àrea: Filosofia i espiritualitat');
    });
    it('uses meaningful hints or a localized placeholder while an ID is unavailable', () => {
        expect(pageReferenceTitle(id, {}, 'A book')).toBe('A book');
        expect(pageReferenceTitle(id, {}, '', 'Pàgina no disponible')).toBe('Pàgina no disponible');
        expect(readablePageTitle(`Índex · Àrea: ${area}`, {}, 'Pàgina no disponible'))
            .toBe('Índex · Àrea: Pàgina no disponible');
        expect(pageReferenceTitle('A concept', {})).toBe('A concept');
    });
    it('does not loop through circular or ID-only cached titles', () => {
        expect(pageReferenceTitle(id, { [id]: id }, '', 'Unknown')).toBe('Unknown');
    });
});
