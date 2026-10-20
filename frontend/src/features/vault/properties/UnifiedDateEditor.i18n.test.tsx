import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import ca from '../../../shared/i18n/locales/ca/translation.json';
import en from '../../../shared/i18n/locales/en/translation.json';
import es from '../../../shared/i18n/locales/es/translation.json';
import fr from '../../../shared/i18n/locales/fr/translation.json';
import { VaultDateProperty } from './VaultDateProperty';
import { unifiedDate } from '../../../shared/dates/unifiedDate';

const preferences = vi.hoisted(() => ({ dateLocale: 'ca-ES', dateFormat: 'locale' }));
vi.mock('../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => preferences }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each(Object.entries({ ca, en, es, fr }))('translates date and planning controls in %s without fallbacks', async (language, translation) => {
    preferences.dateLocale = translation._meta.intlLocale;
    preferences.dateFormat = 'locale';
    const locale = createInstance();
    const missing: string[] = [];
    await locale.init({ lng: language, fallbackLng: false, resources: { [language]: { translation } },
        saveMissing: true, missingKeyHandler: (_languages, _namespace, key) => { missing.push(key); } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const value = unifiedDate({ kind: 'period', start: '2026-10-15T10:00', end: '2026-10-17T18:00',
        predecessorIds: ['before'], startMode: 'auto', constraintType: 'SNET' });
    const clickLabel = async (label: string) => {
        const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label || item.getAttribute('aria-label') === label);
        expect(button).toBeDefined();
        await act(async () => { button?.click(); await Promise.resolve(); });
    };
    try {
        await act(async () => { root.render(<I18nextProvider i18n={locale}><VaultDateProperty value={value}
            onChange={vi.fn()} onRruleChange={vi.fn()} planningEnabled fieldName="Data" noteId="task"
            fieldConfig={{ id: 'date', predecessors_enabled: true }}
            notes={[{ id: 'before', title: 'Earlier task', metadata: { Data: '2026-10-14' } }]} />
        </I18nextProvider>); await Promise.resolve(); });
        expect(container.textContent).not.toContain('vault_date.');
        await clickLabel(translation.schema.period_planning);
        await clickLabel(translation.vault_date.period_constraint_help_toggle);
        const toggleAll = container.querySelector('[role="region"] button');
        expect(toggleAll).not.toBeNull();
        await act(async () => { (toggleAll as HTMLButtonElement).click(); await Promise.resolve(); });
        await act(async () => { (container.querySelector('[role="region"] button') as HTMLButtonElement).click(); await Promise.resolve(); });
        expect(missing).toEqual([]);
        expect(container.textContent).not.toContain('vault_date.');
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
        container.remove();
    }
});

it('updates every visible boundary and the summary when Settings changes, without saving dates', async () => {
    const locale = createInstance();
    await locale.init({ lng: 'ca', fallbackLng: false, resources: { ca: { translation: ca } } });
    preferences.dateLocale = 'ca-ES';
    preferences.dateFormat = 'DD/MM/YYYY';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const save = vi.fn();
    const value = unifiedDate({ kind: 'period', withTime: false, start: '2026-10-12', end: '2026-10-13',
        predecessorIds: ['before'], constraintType: 'SNET', constraintDate: '2026-10-11', deadline: '2026-10-16' });
    const render = async () => {
        await act(async () => { root.render(<I18nextProvider i18n={locale}><VaultDateProperty value={value}
            onChange={save} planningEnabled fieldName="Data" noteId="task" fieldConfig={{ id: 'date' }} />
        </I18nextProvider>); await Promise.resolve(); });
    };
    try {
        await render();
        const planning = Array.from(container.querySelectorAll('button')).find(button => button.textContent === ca.schema.period_planning);
        await act(async () => { planning?.click(); await Promise.resolve(); });
        for (const [format, expected] of [
            ['DD/MM/YYYY', ['12/10/2026', '13/10/2026', '12/10/2026', '13/10/2026', '11/10/2026', '16/10/2026']],
            ['MM/DD/YYYY', ['10/12/2026', '10/13/2026', '10/12/2026', '10/13/2026', '10/11/2026', '10/16/2026']],
            ['YYYY-MM-DD', ['2026-10-12', '2026-10-13', '2026-10-12', '2026-10-13', '2026-10-11', '2026-10-16']],
        ] as const) {
            preferences.dateFormat = format;
            await render();
            expect(Array.from(container.querySelectorAll('input[type="text"]')).map(input => (input as HTMLInputElement).value)).toEqual(expected);
            expect(container.querySelector('section')?.textContent).toContain(expected[0]);
            expect(container.querySelector('section')?.textContent).toContain(expected[1]);
        }
        expect(save).not.toHaveBeenCalled();
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
        container.remove();
    }
});

function editInput(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Missing native input setter');
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

it('rejects invalid scalar and planning edits without clearing persisted dates, and keeps explicit clearing', async () => {
    const locale = createInstance();
    await locale.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en } } });
    preferences.dateLocale = 'en-US';
    preferences.dateFormat = 'MM/DD/YYYY';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const save = vi.fn();
    const value = unifiedDate({ kind: 'period', start: '2026-10-12', end: '2026-10-13',
        predecessorIds: ['before'], constraintType: 'SNET', constraintDate: '2026-10-11', deadline: '2026-10-16' });
    try {
        await act(async () => { root.render(<I18nextProvider i18n={locale}><VaultDateProperty value={value}
            onChange={save} planningEnabled fieldConfig={{ id: 'date' }} /></I18nextProvider>); await Promise.resolve(); });
        const planning = Array.from(container.querySelectorAll('button')).find(button => button.textContent === en.schema.period_planning);
        expect(planning).toBeDefined();
        await act(async () => { planning?.click(); await Promise.resolve(); });
        const inputForLabel = (text: string): HTMLInputElement => {
            const label = Array.from(container.querySelectorAll('label')).find(candidate =>
                Array.from(candidate.querySelectorAll('span')).some(span => span.textContent.trim() === text));
            const input = label?.querySelector<HTMLInputElement>('input[type="text"]');
            if (!input) throw new Error(`Missing date control: ${text}`);
            return input;
        };
        const start = inputForLabel(en.vault_date.period_calculation_start);
        const end = inputForLabel(en.vault_date.period_calculation_finish);
        const planningStart = inputForLabel(en.vault_date.period_start_days);
        const planningEnd = inputForLabel(en.vault_date.period_end_days);
        const constraint = inputForLabel(en.vault_date.period_constraint_date_days);
        const deadline = inputForLabel(en.vault_date.period_deadline_days);
        expect(new Set([start, end, planningStart, planningEnd, constraint, deadline]).size).toBe(6);
        expect(container.querySelectorAll('input[type="text"]')).toHaveLength(6);
        expect([start, end, constraint, deadline].map(input => input.value)).toEqual([
            '10/12/2026', '10/13/2026', '10/11/2026', '10/16/2026',
        ]);
        // Invalid edits must preserve both scalar and planning boundaries.
        for (const input of container.querySelectorAll<HTMLInputElement>('input[type="text"]')) {
            await act(async () => { editInput(input, '02/30/2026'); await Promise.resolve(); });
            await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await Promise.resolve(); });
        }
        expect(save).not.toHaveBeenCalled();
        expect(planningStart.value).toBe('10/12/2026');
        expect(planningEnd.value).toBe('10/13/2026');
        expect(constraint.value).toBe('10/11/2026');
        expect(deadline.value).toBe('10/16/2026');
        await act(async () => { editInput(start, '10/11/2026'); await Promise.resolve(); });
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ start: '2026-10-11', end: '2026-10-13' }));
        await act(async () => { editInput(start, ''); await Promise.resolve(); });
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ start: '', end: '2026-10-13' }));
        await act(async () => { editInput(deadline, ''); await Promise.resolve(); });
        await act(async () => { deadline.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await Promise.resolve(); });
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ deadline: '' }));
        await act(async () => { editInput(constraint, ''); await Promise.resolve(); });
        await act(async () => { constraint.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); await Promise.resolve(); });
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ constraintDate: '' }));
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
        container.remove();
    }
});

it('uses the field format for recurrence-until and serializes its date without changing the main date', async () => {
    const locale = createInstance();
    await locale.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: en } } });
    preferences.dateLocale = 'en-US';
    preferences.dateFormat = 'MM/DD/YYYY';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const save = vi.fn();
    const saveRule = vi.fn();
    try {
        await act(async () => { root.render(<I18nextProvider i18n={locale}><VaultDateProperty value="2026-10-12"
            onChange={save} onRruleChange={saveRule} rruleValue="FREQ=DAILY;UNTIL=20261016T235959Z"
            fieldConfig={{ format: { dateFormat: 'DD/MM/YYYY' } }} /></I18nextProvider>); await Promise.resolve(); });
        const repeat = container.querySelector<HTMLButtonElement>(`button[title="${en.vault_date.toggle_recurrence}"]`);
        expect(repeat).not.toBeNull();
        await act(async () => { repeat?.click(); await Promise.resolve(); });
        const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
        expect(inputs.map(input => input.value)).toEqual(['12/10/2026', '16/10/2026']);
        const until = inputs[1];
        if (!until) throw new Error('Missing recurrence-until input');
        await act(async () => { editInput(until, '17/10/2026'); await Promise.resolve(); });
        expect(saveRule).toHaveBeenLastCalledWith(expect.stringContaining('UNTIL=20261017T235959Z'));
        expect(save).not.toHaveBeenCalled();
    } finally {
        await act(async () => { root.unmount(); await Promise.resolve(); });
        container.remove();
    }
});
