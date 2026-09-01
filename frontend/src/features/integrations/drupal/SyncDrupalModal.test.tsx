import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDrupalModal } from './SyncDrupalModal';


const mocks = vi.hoisted(() => ({
    logError: vi.fn(),
    syncDrupal: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            fallbackOrValues?: string | Readonly<Record<string, unknown>>,
        ) => typeof fallbackOrValues === 'string'
            ? fallbackOrValues
            : (typeof fallbackOrValues?.defaultValue === 'string'
                ? fallbackOrValues.defaultValue
                : key),
    }),
}));


vi.mock('../../../shared/hooks/useModalKeyboard', () => ({ useModalKeyboard: vi.fn() }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: mocks.logError }));
vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock('../../../shared/api/translation', () => ({
    syncDrupalRow: mocks.syncDrupal,
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.resetAllMocks();
    mocks.syncDrupal.mockResolvedValue({
        created: false,
        item_id: 'note-1',
        languages: ['ca', 'es'],
        media_pushed: true,
        nid: 42,
        scope: 'lang_only',
        skipped_fields: [],
        source_lang: 'ca',
        status: 'ok',
        translations: [{ langcode: 'es', status: 'ok' }],
        url: 'https://temenosismael.org/node/42',
        uuid: 'uuid-42',
    });
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});


describe('SyncDrupalModal', () => {
    it('syncs the selected language and media, then reports the result', async () => {
        const onClose = vi.fn();
        const onSynced = vi.fn();
        act(() => {
            root.render(
                <SyncDrupalModal
                    isOpen
                    noteId="note-1"
                    onClose={onClose}
                    onSynced={onSynced}
                    recordMetadata={{
                        drupal_nid: 42,
                        drupal_url: 'https://temenosismael.org/node/42',
                        drupal_uuid: 'uuid-42',
                    }}
                />,
            );
        });
        const languageOnly = container.querySelector(
            'input[name="drupal-scope"][value="lang_only"]',
        ) ?? [...container.querySelectorAll('input[type="radio"]')][1];
        const media = container.querySelector('input[type="checkbox"]');
        if (!(languageOnly instanceof HTMLInputElement)
            || !(media instanceof HTMLInputElement)) {
            throw new Error('Drupal sync controls were not rendered');
        }
        act(() => {
            languageOnly.click();
            media.click();
        });
        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Update'));
        if (!submit) throw new Error('Drupal sync submit was not rendered');
        await act(async () => {
            submit.click();
            await Promise.resolve();
        });

        expect(mocks.syncDrupal).toHaveBeenCalledWith({
            button_action: 'sync_drupal',
            item_id: 'note-1',
            push_media: true,
            scope: 'lang_only',
        });
        expect(onSynced).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
        expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    });

    it('reports a failed production sync through the shared error channel', async () => {
        mocks.syncDrupal.mockRejectedValueOnce(new Error('Drupal unavailable'));
        act(() => {
            root.render(
                <SyncDrupalModal
                    isOpen
                    noteId="note-2"
                    onClose={vi.fn()}
                />,
            );
        });
        const submit = [...container.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Create and sync'));
        if (!submit) throw new Error('Drupal sync submit was not rendered');
        await act(async () => {
            submit.click();
            await Promise.resolve();
        });
        expect(mocks.logError).toHaveBeenCalledWith(
            'sync-drupal-row',
            expect.any(Error),
        );
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.stringContaining('Drupal unavailable'),
        );
    });
});
