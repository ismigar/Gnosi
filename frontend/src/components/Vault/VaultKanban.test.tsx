import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultKanban, type VaultKanbanProps } from './VaultKanban';


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
        preview: null,
    }),
}));


vi.mock('./VaultBulkActionsBar', () => ({ VaultBulkActionsBar: () => null }));


const schema = {
    Status: 'select',
    Status_config: {
        options: [
            { color: 'blue', name: 'Idea' },
            { color: 'green', name: 'Done' },
        ],
    },
};


describe('VaultKanban', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
        vi.clearAllMocks();
    });

    it('renders records and opens a card', () => {
        const onNoteSelect = vi.fn();
        act(() => {
            root.render(<VaultKanban
                activeView={{ groupBy: 'Status' }}
                notes={[{
                    id: 'page-1',
                    last_modified: '2026-08-29T10:00:00Z',
                    metadata: { Status: 'Idea' },
                    title: 'Research note',
                }]}
                onNoteSelect={onNoteSelect}
                schema={schema}
                searchTerm=""
            />);
        });

        const title = Array.from(container.querySelectorAll('span'))
            .find((element) => element.textContent === 'Research note');
        const card = title?.closest<HTMLDivElement>('div[draggable]');
        if (!card) throw new Error('Kanban card not rendered');
        act(() => { card.click(); });
        expect(onNoteSelect).toHaveBeenCalledWith('page-1');
    });

    it('keeps record creation separate from view configuration', () => {
        const onCreateRecord = vi.fn();
        act(() => {
            root.render(<VaultKanban
                notes={[]}
                onCreateRecord={onCreateRecord}
                onNoteSelect={vi.fn()}
            />);
        });

        const addButton = Array.from(container.querySelectorAll('button'))
            .find((button) => button.textContent.includes('Add record'));
        if (!addButton) throw new Error('Add record button not rendered');
        act(() => { addButton.click(); });
        expect(onCreateRecord).toHaveBeenCalledOnce();
    });

    it('optimistically moves a card and persists the real metadata key', async () => {
        const onUpdateNote = vi.fn<NonNullable<VaultKanbanProps['onUpdateNote']>>()
            .mockResolvedValue(undefined);
        act(() => {
            root.render(<VaultKanban
                activeView={{ groupBy: 'Status' }}
                notes={[{
                    id: 'page-1',
                    metadata: { '📌 Status': 'Idea' },
                    title: 'Movable note',
                }]}
                onNoteSelect={vi.fn()}
                onUpdateNote={onUpdateNote}
                schema={schema}
                searchTerm=""
            />);
        });

        const title = Array.from(container.querySelectorAll('span'))
            .find((element) => element.textContent === 'Movable note');
        const card = title?.closest<HTMLDivElement>('div[draggable="true"]');
        const doneHeader = Array.from(container.querySelectorAll('h3'))
            .find((element) => element.textContent.includes('Done'));
        const doneColumn = doneHeader?.parentElement?.parentElement;
        if (!card || !doneColumn) throw new Error('Drag source or destination missing');

        let payload = '';
        const dataTransfer = {
            dropEffect: 'none',
            effectAllowed: 'none',
            getData: () => payload,
            setData: (_format: string, value: string) => { payload = value; },
        };
        const start = new Event('dragstart', { bubbles: true });
        Object.defineProperty(start, 'dataTransfer', { value: dataTransfer });
        act(() => { card.dispatchEvent(start); });
        const drop = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
        await act(async () => {
            doneColumn.dispatchEvent(drop);
            await Promise.resolve();
        });

        expect(onUpdateNote).toHaveBeenCalledWith('page-1', {
            metadata: { '📌 Status': 'Done' },
        });
        expect(doneColumn.textContent).toContain('Movable note');
    });
});
