import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defineStorageKey,
    removeStorage,
    stringStorageCodec,
} from '../../../shared/platform/browser-storage';
import WorkspacesModal from './WorkspacesModal';
import type { SavedWorkspace } from './workspacesModel';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const workspacesStorageKey = defineStorageKey(
    'gnosi.workspaces',
    stringStorageCodec,
);

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            fallback: string,
            values?: { count?: number },
        ): string => values?.count === undefined
            ? fallback
            : fallback.replace('{{count}}', String(values.count)),
    }),
}));

function setInput(input: HTMLInputElement, value: string): void {
    act(() => {
        const setValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )?.set?.bind(input);
        if (!setValue) throw new Error('Missing native input value setter');
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}

describe('WorkspacesModal', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        removeStorage(workspacesStorageKey);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        removeStorage(workspacesStorageKey);
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('saves all document kinds and restores their exact payload', () => {
        const onClose = vi.fn<() => void>();
        const onRestore = vi.fn<(workspace: SavedWorkspace) => void>();
        act(() => {
            root.render(
                <WorkspacesModal
                    currentTabs={[
                        { id: 'page-1', title: 'Page' },
                        { id: 'table-1', isTable: true, title: 'Table' },
                        { id: 'pdf-1', isPdf: true, title: 'PDF' },
                        { id: 'drawing-1', isDrawing: true, title: 'Drawing' },
                    ]}
                    isOpen
                    onClose={onClose}
                    onRestore={onRestore}
                />,
            );
        });

        const input = container.querySelector('input');
        if (!(input instanceof HTMLInputElement)) {
            throw new Error('Missing workspace name input');
        }
        expect(input.placeholder).toContain('4 open tabs');
        setInput(input, 'Research');
        act(() => {
            findButton(container, 'Save').click();
        });
        act(() => {
            findButton(container, 'Research').click();
        });

        expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({
            version: 2,
            name: 'Research',
            tabs: [
                { id: 'page-1', type: 'page', title: 'Page' },
                { id: 'table-1', type: 'table', isTable: true, tableId: 'table-1', title: 'Table' },
                { id: 'pdf-1', type: 'document', isPdf: true, kind: 'pdf', src: '', location: null, title: 'PDF' },
                { id: 'drawing-1', type: 'drawing', isDrawing: true, title: 'Drawing' },
            ],
            layout: { activeTabId: 'page-1', activeTableId: null, activeViewId: null, viewMode: 'editor', splitTabIds: [], splitTableIds: [], paneSizes: [100] },
        }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
