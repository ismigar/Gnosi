import { describe, expect, it, vi } from 'vitest';
import { dateInputBoundary, dateInputPlaceholder, formattedDateInputValue } from './dateModel';
import { createPlanningPeriodModel } from './planningModel';

const formats = ['locale', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const locales = ['ca-ES', 'en-US', 'es-ES', 'fr-FR'];

describe('editable date formatting', () => {
    it.each(locales)('round-trips numeric dates and 24-hour times in %s for every Settings format', locale => {
        for (const format of formats) {
            for (const value of ['2026-10-12T00:05', '2026-10-12T14:45']) {
                const displayed = formattedDateInputValue(value, 'datetime', locale, format);
                expect(displayed).not.toMatch(/AM|PM|24:/);
                expect(dateInputBoundary(displayed, 'datetime', locale, format)).toBe(value);
            }
            const displayed = formattedDateInputValue('2026-10-12', 'date', locale, format);
            expect(dateInputBoundary(displayed, 'date', locale, format)).toBe('2026-10-12');
        }
    });

    it('uses the selected numeric order rather than guessing from ambiguous values', () => {
        expect(dateInputBoundary('03/04/2026', 'date', 'en-US', 'DD/MM/YYYY')).toBe('2026-04-03');
        expect(dateInputBoundary('03/04/2026', 'date', 'fr-FR', 'MM/DD/YYYY')).toBe('2026-03-04');
        expect(dateInputBoundary('03/04/2026', 'date', 'en-US')).toBe('2026-03-04');
        expect(dateInputBoundary('03/04/2026', 'date', 'fr-FR')).toBe('2026-04-03');
    });

    it.each(['-0044-03-15T09:00', '0000-03-15T09:00', '0099-03-15T09:00', '10000-03-15T09:00'])(
        'preserves historical and extended years: %s', value => {
            for (const format of formats) {
                const displayed = formattedDateInputValue(value, 'datetime', 'en-US', format);
                expect(dateInputBoundary(displayed, 'datetime', 'en-US', format)).toBe(value);
            }
        },
    );

    it.each(['31/02/2026', '29/02/2025', '12/13/2026', '12/10/26', '12/10/2026 24:00',
        '12/10/2026 10:60', '12/10/', 'invalid', '   '])('rejects invalid or incomplete edits: %s', raw => {
        expect(dateInputBoundary(raw, 'datetime', 'ca-ES', 'DD/MM/YYYY')).toBe('');
    });

    it('keeps translated placeholder tokens in the chosen date order', () => {
        expect(dateInputPlaceholder('en-US', 'MM/DD/YYYY', 'JJ/MM/AAAA HH:MM')).toBe('MM/JJ/AAAA HH:MM');
        expect(dateInputPlaceholder('fr-FR', 'YYYY-MM-DD', 'JJ/MM/AAAA')).toBe('AAAA-MM-JJ');
    });

    it('formats planning boundaries and summary consistently while preserving year input semantics', () => {
        const props = {
            fieldConfig: { period_unit: 'days' }, fieldName: 'Date', idToTitle: {}, noteId: 'task', notes: [],
            onChange: vi.fn(), planningEnabled: true, planningSettings: { workday_start: '09:00' },
            value: { start: '2026-10-12T09:00', end: '2026-10-13T17:00' },
        };
        const model = createPlanningPeriodModel(props, 'fr-FR', 'MM/DD/YYYY');
        expect(model.summaryStart).toBe('10/12/2026');
        expect(model.summaryEnd).toBe('10/13/2026');
        expect(model.periodInputToBoundary('10/12/2026')).toBe('2026-10-12T09:00');
        expect(model.periodInputToBoundary('02/30/2026')).toBe('');
        const years = createPlanningPeriodModel({ ...props, fieldConfig: { period_unit: 'years' } }, 'en-US');
        expect(years.periodInputToBoundary('-44')).toBe('-0044-01-01T09:00');
        expect(years.periodInputToBoundary('99')).toBe('0099-01-01T09:00');
        expect(props.onChange).not.toHaveBeenCalled();
    });
});
