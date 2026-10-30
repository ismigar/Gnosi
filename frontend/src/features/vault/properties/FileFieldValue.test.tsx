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
    fileKindFromValue: (target: string) => target.endsWith('.jpg') ? 'image' : 'document',
    openFileResource: testState.openFileResource,
    parseFileEntries: (value: unknown) => (
        value === '[Research paper](https://example.test/paper.pdf)'
            ? [{ label: 'Research paper', target: 'https://example.test/paper.pdf' }]
            : value === 'Assets/cover.jpg' ? [{ label: 'Cover', target: 'Assets/cover.jpg' }] : []
    ),
    toAssetPreviewUrl: (target: string) => `/api/vault/assets/${target.replace('Assets/', '')}`,
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

    it.each(['table', 'gallery', 'feed', 'detail'] as const)('previews the image chip label and open button in %s without changing clicks', variant => {
        const onRemove = vi.fn();
        const cellClick = vi.fn();
        act(() => { root.render(<MemoryRouter><div onClick={cellClick}>
            <FileFieldValue value="Assets/cover.jpg" variant={variant} onRemove={onRemove} />
        </div></MemoryRouter>); });
        const label = Array.from(container.querySelectorAll('span')).find(node => node.textContent === 'Cover' && node.className.includes('truncate'));
        const open = container.querySelector<HTMLButtonElement>('button[title="Open"]');
        const remove = container.querySelector<HTMLButtonElement>('button[title="Delete"]');
        if (!label || !open || !remove) throw new Error('Missing image chip controls');
        expect(document.body.querySelectorAll('img')).toHaveLength(1);
        act(() => { label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
        expect(document.body.querySelectorAll('img')).toHaveLength(2);
        const popup = document.body.querySelector('img[src="/api/vault/assets/cover.jpg"]:not([class*="shrink-0"])');
        if (!popup) throw new Error('Missing image preview');
        act(() => { popup.dispatchEvent(new Event('load')); });
        expect(popup.parentElement?.textContent).not.toContain('…');
        act(() => { label.click(); });
        expect(cellClick).toHaveBeenCalledOnce();
        act(() => { open.focus(); open.click(); });
        expect(document.body.querySelectorAll('img')).toHaveLength(2);
        expect(document.body.contains(popup)).toBe(true);
        expect(popup.parentElement?.textContent).not.toContain('…');
        act(() => { remove.focus(); });
        expect(document.body.contains(popup)).toBe(true);
        expect(popup.parentElement?.textContent).not.toContain('…');
        expect(testState.openFileResource.mock.calls[0]?.[0]).toBe('Assets/cover.jpg');
        expect(cellClick).toHaveBeenCalledOnce();
        act(() => { remove.click(); });
        expect(onRemove).toHaveBeenCalledWith(0);
        expect(cellClick).toHaveBeenCalledOnce();
        act(() => { open.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })); });
        expect(document.body.querySelectorAll('img')).toHaveLength(1);
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
