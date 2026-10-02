import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import ca from '../../../../shared/i18n/locales/ca/translation.json';
import es from '../../../../shared/i18n/locales/es/translation.json';
import en from '../../../../shared/i18n/locales/en/translation.json';
import fr from '../../../../shared/i18n/locales/fr/translation.json';
import type { HandwritingStatusResponse } from '../../../../shared/api/drawings';
import { HandwritingModelStatus } from './HandwritingModelStatus';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each(Object.entries({ ca, es, en, fr }))('shows download size and cancellation in %s without loading a model', async (language, translation) => {
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation } } });
    const container = document.createElement('div');
    const root = createRoot(container);
    const cancel = vi.fn(() => Promise.resolve());
    const status: HandwritingStatusResponse = {
        available: true, loaded: false, model: 'fixture', downloaded: false,
        state: 'downloading', downloaded_bytes: 4 * 1024 ** 2, total_bytes: 8 * 1024 ** 2,
        error: '', cancelling: false,
    };
    const render = async (change: Partial<HandwritingStatusResponse>) => {
        await act(async () => { root.render(<I18nextProvider i18n={i18n}><HandwritingModelStatus status={{ ...status, ...change }} onCancel={cancel} /></I18nextProvider>); await Promise.resolve(); });
    };
    try {
        await render({});
        expect(container.textContent).toContain(translation.tldraw.ocr_downloading);
        const format = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        expect(container.textContent).toContain(`${format.format(4)} / ${format.format(8)} MiB`);
        await act(async () => { container.querySelector('button')?.click();  await Promise.resolve(); });
        expect(cancel).toHaveBeenCalledOnce();
        await render({ cancelling: true });
        expect(container.querySelector('button')?.disabled).toBe(true);
        expect(container.textContent).toContain(translation.tldraw.ocr_cancelling);
        await render({ state: 'loading' });
        expect(container.querySelector('button')).toBeNull();
        expect(container.textContent).toContain(translation.tldraw.ocr_loading);
        await render({ state: 'downloaded', downloaded: true });
        expect(container.textContent).toContain(translation.tldraw.ocr_downloaded);
        await render({ state: 'failed', error: 'InsufficientDiskSpace' });
        expect(container.textContent).toContain(translation.tldraw.ocr_disk_space);
        expect(container.textContent).not.toContain('tldraw.');
    } finally {
        await act(async () => { root.unmount();  await Promise.resolve(); });
    }
});
