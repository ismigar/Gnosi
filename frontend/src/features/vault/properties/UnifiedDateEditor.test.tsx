import ca from '../../../shared/i18n/locales/ca/translation.json';
import en from '../../../shared/i18n/locales/en/translation.json';
import es from '../../../shared/i18n/locales/es/translation.json';
import fr from '../../../shared/i18n/locales/fr/translation.json';
import { evaluateFormula } from './formulaUtils';
import { evaluateRollup } from './rollupUtils';
import { matchesRule } from '../../../shared/filtering/vaultFilters';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VaultDateProperty } from './VaultDateProperty';
import { unifiedDate, type UnifiedDateValue } from '../../../shared/dates/unifiedDate';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ dateLocale: 'ca-ES' }) }));
const roots: { container: HTMLDivElement; root: Root }[] = [];
beforeAll(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { for (const { container, root } of roots.splice(0)) { act(() => { root.unmount(); }); container.remove(); } });
function mount(content: ReactNode) {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container); roots.push({ container, root });
    act(() => { root.render(content); }); return container;
}
function Fixture({ initial, save }: { initial: UnifiedDateValue; save: (value: unknown) => void }) {
    const [value, setValue] = useState(initial);
    return <VaultDateProperty value={value} onChange={next => { const date = unifiedDate(next); setValue(date); save(next); }} />;
}
function modality(container: HTMLDivElement, value: string) {
    const select = container.querySelector('select');
    if (!select) throw new Error('Missing modality selector');
    act(() => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
describe('unified date editor', () => {
    it('restores the saved interval and hours after both independent mode toggles', () => {
        const save = vi.fn();
        const date = unifiedDate('2026-10-15T10:00/2026-10-17T18:00');
        const container = mount(<Fixture initial={date} save={save} />);
        modality(container, 'point');
        expect(container.querySelectorAll('input[type="datetime-local"]')).toHaveLength(1);
        modality(container, 'period');
        expect(container.querySelectorAll('input[type="datetime-local"]')).toHaveLength(2);
        const toggle = container.querySelector('[role="switch"]');
        if (!(toggle instanceof HTMLElement)) throw new Error('Missing clock switch');
        act(() => { toggle.click(); });
        expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
        act(() => { toggle.click(); });
        expect(save.mock.lastCall?.[0]).toMatchObject({ kind: 'period', withTime: true, start: '2026-10-15T10:00', end: '2026-10-17T18:00' });
    });
    it('keeps an open period explicit after the finish is cleared', () => {
        const save = vi.fn();
        const container = mount(<Fixture initial={unifiedDate('2026-10-15/2026-10-17')} save={save} />);
        const clear = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'vault_date.clear_end');
        if (!clear) throw new Error('Missing clear finish action');
        act(() => { clear.click(); });
        expect(save.mock.lastCall?.[0]).toMatchObject({ kind: 'period', end: '' });
        expect(container.textContent).toContain('vault_date.end_pending');
        expect(container.querySelector('select')?.value).toBe('period');
    });
    it('calculates a multi-day timed finish from a duration without dropping planning extensions', () => {
        const save = vi.fn();
        const container = mount(<Fixture initial={unifiedDate({ kind: 'period', start: '2026-10-15T10:00', end: '', custom: 'keep' })} save={save} />);
        const duration = container.querySelector('input[type="number"]');
        if (!(duration instanceof HTMLInputElement)) throw new Error('Missing duration input');
        act(() => {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            descriptor?.set?.call(duration, '56'); duration.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(save.mock.lastCall?.[0]).toMatchObject({ end: '2026-10-17T18:00', custom: 'keep' });
    });
    it('preserves date comparisons, formulas and boundary rollups with structured values', () => {
        const date = unifiedDate('2026-10-15T10:00/2026-10-17T18:00');
        expect(matchesRule({ metadata: { Data: date } }, { field: 'Data', operator: 'equals', value: '2026-10-15' })).toBe(true);
        expect(matchesRule({ metadata: { Data: date } }, { field: 'Data', periodPart: 'end', operator: 'equals', value: '2026-10-17' })).toBe(true);
        expect(evaluateFormula("prop('Data') == '2026-10-15'", { Data: { ...date, withTime: false } })).toBe(true);
        expect(evaluateRollup([date, unifiedDate('2026-10-14')], 'earliest')).toBe('2026-10-14');
        expect(evaluateRollup([date, unifiedDate('2026-10-14')], 'latest')).toBe('2026-10-17T18:00');
    });
});

// Use real catalogues: the editor's key-returning mock cannot catch missing labels.
describe('unified date translations', () => {
    it.each([['ca', ca], ['en', en], ['es', es], ['fr', fr]])('provides boundary and duration labels in %s', (_locale, catalogue) => {
        for (const key of ['period_calculation_start', 'period_calculation_finish', 'period_calculation_duration', 'period_calculation_summary', 'period_calculation_predecessor'] as const) {
            expect(catalogue.vault_date[key]).toBeTruthy();
            expect(catalogue.vault_date[key]).not.toContain('vault_date.');
        }
    });
});
