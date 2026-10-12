import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { VaultTimeline } from './VaultTimeline';
import { RecordSubitemContext } from './recordSubitemContext';
import type { VaultTimelineProps } from './vault-timeline/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ currencyCode: 'EUR', dateFormat: 'YYYY-MM-DD', dateLocale: 'en-US', decimalSymbol: '.', numberLocale: 'en-US' }) }));
vi.mock('../plugins/usePlugins', () => ({ usePlugins: () => ({ getPluginSettings: () => ({}), isEnabled: () => false }) }));
vi.mock('../editor/useTitlePreview', () => ({ useTitlePreview: () => ({ getTitleProps: () => ({}), preview: null }) }));

it('keeps subitem creation beside the title while preserving timeline row moves', async () => {
    const addSubitem = vi.fn();
    const update = vi.fn<NonNullable<VaultTimelineProps['onUpdateNote']>>().mockResolvedValue(undefined);
    const view = mountTestComponent(<RecordSubitemContext.Provider value={addSubitem}>
        <VaultTimeline activeView={{ dateField: 'Start' }} schema={{ Start: 'date' }}
            notes={[{ id: 'a', title: 'First task', metadata: { Start: '2026-10-12' } }, { id: 'b', title: 'Second task', metadata: { Start: '2026-10-13' } }]}
            onUpdateNote={update} />
    </RecordSubitemContext.Provider>);
    const row = view.container.querySelector('[data-timeline-row="a"]');
    const add = row?.querySelector<HTMLButtonElement>('[aria-label="table.add_subitem"]');
    const down = row?.querySelector<HTMLButtonElement>('[aria-label="timeline.move_down"]');
    if (!add || !down) throw new Error('Both subitem and row-move actions must be present');
    expect(add.parentElement?.textContent).toContain('First task');
    act(() => { add.click(); });
    expect(addSubitem).toHaveBeenCalledExactlyOnceWith('a');
    expect(update).not.toHaveBeenCalled();
    expect(down.disabled).toBe(false);
    await act(async () => { down.click(); await Promise.resolve(); });
    expect(update.mock.calls.map(([id]) => id)).toEqual(['b', 'a']);
});
