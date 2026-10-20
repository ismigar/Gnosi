import { expect, it } from 'vitest';
import { dateInputBoundary, dateInputPlaceholder, formattedDateInputValue } from './dateModel';

it.each([
    ['ca-ES', 'locale', '12/10/2026', 'DD/MM/AAAA'],
    ['es-ES', 'locale', '12/10/2026', 'DD/MM/AAAA'],
    ['fr-FR', 'locale', '12/10/2026', 'JJ/MM/AAAA'],
    ['en-US', 'locale', '10/12/2026', 'MM/DD/YYYY'],
    ['en-GB', 'locale', '12/10/2026', 'DD/MM/YYYY'],
    ['ca-ES', 'MM/DD/YYYY', '10/12/2026', 'MM/DD/AAAA'],
    ['en-US', 'DD/MM/YYYY', '12/10/2026', 'DD/MM/YYYY'],
    ['fr-FR', 'YYYY-MM-DD', '2026-10-12', 'AAAA-MM-JJ'],
])('uses %s with %s for display, input and the translated placeholder', (locale, format, visible, placeholder) => {
    const template = locale === 'fr-FR' ? 'JJ/MM/AAAA' : locale.startsWith('en') ? 'DD/MM/YYYY' : 'DD/MM/AAAA';
    expect(formattedDateInputValue('2026-10-12', 'date', locale, format)).toBe(visible);
    expect(dateInputBoundary(visible, 'date', locale, format)).toBe('2026-10-12');
    expect(dateInputPlaceholder(locale, format, template)).toBe(placeholder);
});

it('keeps day/month order unambiguous and rejects incomplete or invalid dates', () => {
    expect(dateInputBoundary('10/12/2026', 'date', 'ca-ES', 'MM/DD/YYYY')).toBe('2026-10-12');
    expect(dateInputBoundary('10/12/2026', 'date', 'ca-ES', 'DD/MM/YYYY')).toBe('2026-12-10');
    for (const raw of ['31/02/2026', '12/13/2026', '12/10/2', '12/10/2026 25:00']) {
        expect(dateInputBoundary(raw, 'datetime', 'ca-ES', 'DD/MM/YYYY')).toBe('');
    }
    expect(dateInputBoundary('29/02/2028', 'date', 'ca-ES')).toBe('2028-02-29');
});

it('retains clocks and signed years while formatting editable datetimes', () => {
    expect(formattedDateInputValue('2026-10-12T18:30', 'datetime', 'fr-FR', 'MM/DD/YYYY')).toBe('10/12/2026 18:30');
    expect(dateInputBoundary('10/12/2026 18:30', 'datetime', 'fr-FR', 'MM/DD/YYYY')).toBe('2026-10-12T18:30');
    expect(dateInputBoundary('-0044-03-15T09:00', 'datetime', 'ca-ES')).toBe('-0044-03-15T09:00');
});
