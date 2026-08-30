import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileFieldValue, type FileFieldValueProps } from './FileFieldValue';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

type TranslationFallback = string | { readonly defaultValue?: string };

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const testState = vi.hoisted(() => ({
    openFileResource: vi.fn<(
        target: string,
        options: {
            readonly navigate?: unknown;
            readonly t?: unknown;
            readonly title?: string;
        },
    ) => void>(),
}));

vi.mock('../../../shared/resources/fileResource', () => ({
    fileKindFromValue: () => 'document',
    openFileResource: testState.openFileResource,
    parseFileEntries: (value: unknown) => (
        value === '[Research paper](https://example.test/paper.pdf)'
            ? [{ label: 'Research paper', target: 'https://example.test/paper.pdf' }]
            : []
    ),
    toAssetPreviewUrl: () => '',
    toServedAssetUrl: (target: string) => target,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: TranslationFallback): string => {
            if (typeof fallback === 'string') return fallback;
            return fallback?.defaultValue || key;
        },
    }),
}));

describe('FileFieldValue', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        testState.openFileResource.mockReset();
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('keeps Markdown labels, document opening, and indexed removal', () => {
        const onRemove = vi.fn<NonNullable<FileFieldValueProps['onRemove']>>();
        act(() => {
            root.render(
                <MemoryRouter>
                    <FileFieldValue
                        value="[Research paper](https://example.test/paper.pdf)"
                        field="Files"
                        onRemove={onRemove}
                    />
                </MemoryRouter>,
            );
        });

        expect(container.textContent).toContain('Research paper');
        const openButton = container.querySelector('button[title="Open"]');
        const deleteButton = container.querySelector('button[title="Delete"]');
        if (!(openButton instanceof HTMLButtonElement)) {
            throw new Error('Missing file open button');
        }
        if (!(deleteButton instanceof HTMLButtonElement)) {
            throw new Error('Missing file removal button');
        }
        act(() => {
            openButton.click();
            deleteButton.click();
        });

        const openCall = testState.openFileResource.mock.calls.at(0);
        if (!openCall) throw new Error('Missing file open request');
        expect(openCall[0]).toBe('https://example.test/paper.pdf');
        expect(openCall[1].title).toBe('Research paper');
        expect(typeof openCall[1].navigate).toBe('function');
        expect(typeof openCall[1].t).toBe('function');
        expect(onRemove).toHaveBeenCalledWith(0);
    });
});
