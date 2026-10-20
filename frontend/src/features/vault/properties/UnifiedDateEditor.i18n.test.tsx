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
