import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { toast } from '../../lib/toast';
import { translateVaultRow } from '../../shared/api/translation';
import { TranslateLanguagesModal } from './TranslateLanguagesModal';


vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: () => undefined,
}));


vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../shared/api/translation', () => ({
    translateVaultPage: vi.fn(),
    translateVaultRow: vi.fn(),
    translateVaultRows: vi.fn(),
}));


vi.mock('./schemaUtils', () => ({
    detectRecordSourceLang: () => 'es',
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            fallback?: string | { count?: number; defaultValue?: string },
        ) => {
            if (typeof fallback === 'string') return fallback;
            if (fallback?.defaultValue) {
                return fallback.defaultValue.replace('{{count}}', String(fallback.count ?? ''));
            }
            return key;
        },
    }),
}));


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];


beforeAll(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});


afterEach(() => {
    while (mountedRoots.length > 0) {
        const mounted = mountedRoots.pop();
        if (!mounted) continue;
        act(() => { mounted.root.unmount(); });
        mounted.container.remove();
    }
    vi.clearAllMocks();
});


function render(element: ReactElement): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    act(() => { root.render(element); });
}


function checkboxFor(language: string): HTMLInputElement | undefined {
    return [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        .find((input) => input.parentElement?.textContent.includes(language));
}


describe('TranslateLanguagesModal', () => {
    it('hides the detected source language for a single row', () => {
        render(<TranslateLanguagesModal isOpen noteId="row-1" onClose={vi.fn()} />);

        expect(checkboxFor('Castellà')).toBeUndefined();
        expect(checkboxFor('Català')).toBeDefined();
        expect(document.body.textContent).toContain('The original language');
    });

    it('submits selected row languages and closes after success', async () => {
        const result = {
            created: [],
            item_id: 'row-1',
            skipped: [],
            source_lang: 'es',
            status: 'ok' as const,
            updated: [],
        };
        vi.mocked(translateVaultRow).mockResolvedValueOnce(result);
        const onClose = vi.fn();
        const onTranslated = vi.fn();
        render(<TranslateLanguagesModal
            isOpen
            noteId="row-1"
            onClose={onClose}
            onTranslated={onTranslated}
        />);

        act(() => { checkboxFor('Català')?.click(); });
        const submit = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Translate'));
        await act(async () => {
            submit?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(translateVaultRow).toHaveBeenCalledWith({
            button_action: 'translate_row',
            item_id: 'row-1',
            target_languages: ['ca'],
        });
        expect(toast.success).toHaveBeenCalled();
        expect(onTranslated).toHaveBeenCalledWith(result);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('keeps the modal open and reports request failures', async () => {
        vi.mocked(translateVaultRow).mockRejectedValueOnce(new Error('provider unavailable'));
        const onClose = vi.fn();
        render(<TranslateLanguagesModal isOpen noteId="row-1" onClose={onClose} />);

        act(() => { checkboxFor('Català')?.click(); });
        const submit = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Translate'));
        await act(async () => {
            submit?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(toast.error).toHaveBeenCalledWith(
            'Error starting translation: provider unavailable',
        );
        expect(onClose).not.toHaveBeenCalled();
    });
});
