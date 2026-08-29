import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { VaultBulkActionsBar } from './VaultBulkActionsBar';


vi.mock('../ConfirmModal', () => ({
    default: ({ isOpen, onConfirm }: {
        isOpen: boolean;
        onConfirm: () => unknown;
    }) => isOpen
        ? <button data-testid="confirm-template" onClick={() => { void onConfirm(); }} type="button">Confirm</button>
        : null,
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string | { defaultValue?: string }) => (
            typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
        ),
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


function buttonByTitle(title: string): HTMLButtonElement | null {
    return document.body.querySelector(`button[title="${title}"]`);
}


describe('VaultBulkActionsBar', () => {
    it('does not render without a selection', () => {
        render(<VaultBulkActionsBar
            onClearSelection={vi.fn()}
            selectedIds={new Set()}
        />);
        expect(document.body.querySelector('.fixed.bottom-4')).toBeNull();
    });

    it('runs select-all, delete, and deselect actions', () => {
        const onClearSelection = vi.fn();
        const onDeleteSelected = vi.fn();
        const onSelectAll = vi.fn();
        render(<VaultBulkActionsBar
            onClearSelection={onClearSelection}
            onDeleteSelected={onDeleteSelected}
            onSelectAll={onSelectAll}
            selectedIds={new Set(['one'])}
            totalCount={3}
        />);

        act(() => {
            buttonByTitle('Select all')?.click();
            buttonByTitle('Delete selected')?.click();
            buttonByTitle('Deselect')?.click();
        });
        expect(onSelectAll).toHaveBeenCalledOnce();
        expect(onDeleteSelected).toHaveBeenCalledOnce();
        expect(onClearSelection).toHaveBeenCalledOnce();
    });

    it('selects item types and export formats from their menus', () => {
        const onChangeItemType = vi.fn();
        const onExportSelection = vi.fn();
        render(<VaultBulkActionsBar
            itemTypeOptions={[{ label: 'Book', value: 'book' }]}
            onChangeItemType={onChangeItemType}
            onClearSelection={vi.fn()}
            onExportSelection={onExportSelection}
            selectedIds={new Set(['one'])}
        />);

        act(() => { buttonByTitle('Change item type')?.click(); });
        const book = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent === 'Book');
        act(() => { book?.click(); });
        act(() => { buttonByTitle('Export selection')?.click(); });
        const ris = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent === 'RIS (.ris)');
        act(() => { ris?.click(); });

        expect(onChangeItemType).toHaveBeenCalledWith('book');
        expect(onExportSelection).toHaveBeenCalledWith('ris');
    });

    it('requires confirmation before applying a template', () => {
        const onApplyTemplate = vi.fn();
        render(<VaultBulkActionsBar
            onApplyTemplate={onApplyTemplate}
            onClearSelection={vi.fn()}
            selectedIds={new Set(['one', 'two'])}
            templates={[{ id: 'template-1', title: 'Research template' }]}
        />);

        act(() => { buttonByTitle('Apply template')?.click(); });
        const template = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent === 'Research template');
        act(() => { template?.click(); });
        expect(onApplyTemplate).not.toHaveBeenCalled();

        act(() => {
            document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-template"]')?.click();
        });
        expect(onApplyTemplate).toHaveBeenCalledWith('template-1');
    });

    it('closes an open dropdown after an outside click', () => {
        render(<VaultBulkActionsBar
            itemTypeOptions={[{ label: 'Book', value: 'book' }]}
            onChangeItemType={vi.fn()}
            onClearSelection={vi.fn()}
            selectedIds={new Set(['one'])}
        />);

        act(() => { buttonByTitle('Change item type')?.click(); });
        expect(document.body.textContent).toContain('Book');
        act(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(document.body.textContent).not.toContain('Book');
    });
});
