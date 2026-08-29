import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VaultViewToolbar } from './VaultViewToolbar';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback,
    }),
}));

function findButton(container: HTMLElement, title: string): HTMLButtonElement {
    const button = container.querySelector(`button[title="${title}"]`);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${title}`);
    }
    return button;
}

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

describe('VaultViewToolbar', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('keeps toolbar actions and the controlled search contract', () => {
        const onOpenFilters = vi.fn<() => void>();
        const onOpenSort = vi.fn<() => void>();
        const onOpenConfig = vi.fn<() => void>();
        const setSearchTerm = vi.fn<(value: string) => void>();
        const setShowSearch = vi.fn<(value: boolean) => void>();

        act(() => {
            root.render(
                <VaultViewToolbar
                    activeFiltersCount={2}
                    activeSortsCount={1}
                    onOpenConfig={onOpenConfig}
                    onOpenFilters={onOpenFilters}
                    onOpenSort={onOpenSort}
                    setSearchTerm={setSearchTerm}
                    setShowSearch={setShowSearch}
                />,
            );
        });
        act(() => {
            findButton(container, 'Filters').click();
            findButton(container, 'Sort').click();
            findButton(container, 'View settings').click();
            findButton(container, 'Search').click();
        });
        expect(onOpenFilters).toHaveBeenCalledOnce();
        expect(onOpenSort).toHaveBeenCalledOnce();
        expect(onOpenConfig).toHaveBeenCalledOnce();
        expect(setShowSearch).toHaveBeenCalledWith(true);

        act(() => {
            root.render(
                <VaultViewToolbar
                    searchTerm="notes"
                    setSearchTerm={setSearchTerm}
                    setShowSearch={setShowSearch}
                    showSearch
                />,
            );
        });
        const input = container.querySelector('input');
        if (!(input instanceof HTMLInputElement)) {
            throw new Error('Missing search input');
        }
        expect(input.value).toBe('notes');
        setInput(input, 'research');
        expect(setSearchTerm).toHaveBeenCalledWith('research');

        const closeButton = input.parentElement?.querySelector('button');
        if (!(closeButton instanceof HTMLButtonElement)) {
            throw new Error('Missing close-search button');
        }
        act(() => {
            closeButton.click();
        });
        expect(setSearchTerm).toHaveBeenCalledWith('');
        expect(setShowSearch).toHaveBeenCalledWith(false);
    });
});
