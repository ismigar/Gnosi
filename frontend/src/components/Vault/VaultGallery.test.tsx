import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultGallery } from './VaultGallery';


const mocks = vi.hoisted(() => ({
    onNoteSelect: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { readonly defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
    }),
}));


vi.mock('../../hooks/useLocaleSettings', () => ({
    useLocaleSettings: () => ({
        currencyCode: 'EUR',
        dateFormat: 'locale',
        dateLocale: 'en-US',
        decimalSymbol: '.',
        numberLocale: 'en-US',
    }),
}));


vi.mock('./useTitlePreview', () => ({
    useTitlePreview: () => ({
        getTitleProps: () => ({}),
        openForKeyboard: vi.fn(),
        preview: null,
    }),
}));


vi.mock('./VaultBulkActionsBar', () => ({ VaultBulkActionsBar: () => null }));


describe('VaultGallery', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('renders a card and opens the selected note', () => {
        act(() => {
            root.render(<VaultGallery
                activeView={{ galleryPreview: 'none' }}
                notes={[{ id: 'page-1', metadata: {}, title: 'Research note' }]}
                onNoteSelect={mocks.onNoteSelect}
                searchTerm=""
            />);
        });

        expect(container.textContent).toContain('Research note');
        const card = container.querySelector<HTMLDivElement>('div[tabindex="-1"]');
        if (!card) throw new Error('Gallery card not rendered');
        act(() => {
            card.click();
        });
        expect(mocks.onNoteSelect).toHaveBeenCalledWith('page-1');
    });

    it('keeps record creation separate from view settings', () => {
        const onCreateRecord = vi.fn();
        act(() => {
            root.render(<VaultGallery
                activeView={{ galleryPreview: 'none' }}
                notes={[]}
                onCreateRecord={onCreateRecord}
                onNoteSelect={mocks.onNoteSelect}
            />);
        });

        const addButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Add record'));
        if (!addButton) throw new Error('Add record button not rendered');
        act(() => {
            addButton.click();
        });
        expect(onCreateRecord).toHaveBeenCalledOnce();
    });
});
