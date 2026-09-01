import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '../../../shared/notifications/toast';
import { uploadCslStyle } from '../../../shared/api/citation-io';
import CslStylePicker, { type CslStylePickerProps } from './CslStylePicker';
import {
    fetchAvailableStyles,
    invalidateAvailableStylesCache,
    type CslStyleOption,
} from '../../../shared/citations/cslEngine';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface TranslationOptions {
    readonly defaultValue?: string;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;
const translate = (key: string, options?: TranslationOptions): string => (
    options?.defaultValue ?? key
);

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: translate }),
}));

vi.mock('../../../shared/notifications/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../../shared/api/citation-io', () => ({
    uploadCslStyle: vi.fn(),
}));

vi.mock('../../../shared/citations/cslEngine', () => ({
    fetchAvailableStyles: vi.fn(),
    invalidateAvailableStylesCache: vi.fn(),
}));

const styles: CslStyleOption[] = [
    { file: 'apa.csl', id: 'apa', label: 'APA 7th edition', locale: 'en-US' },
    {
        file: 'chicago.csl',
        id: 'chicago-author-date',
        label: 'Chicago Author-Date',
        locale: 'en-US',
    },
];

const fetchAvailableStylesMock = vi.mocked(fetchAvailableStyles);
const invalidateCacheMock = vi.mocked(invalidateAvailableStylesCache);
const uploadCslStyleMock = vi.mocked(uploadCslStyle);
const successToastMock = vi.mocked(toast.success);

function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setter) throw new Error('Missing native input value setter');
    act(() => {
        setter(value);
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

describe('CslStylePicker', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        fetchAvailableStylesMock.mockReset().mockResolvedValue(styles);
        invalidateCacheMock.mockReset();
        uploadCslStyleMock.mockReset();
        successToastMock.mockReset();
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    async function renderPicker(props: CslStylePickerProps): Promise<void> {
        await act(async () => {
            root.render(<CslStylePicker {...props} />);
            await Promise.resolve();
        });
    }

    it('filters the catalog and preserves style selection', async () => {
        const onChange = vi.fn<NonNullable<CslStylePickerProps['onChange']>>();
        await renderPicker({ onChange, value: 'apa' });

        const search = container.querySelector('input[type="text"]');
        if (!(search instanceof HTMLInputElement)) throw new Error('Missing search input');
        expect(findButton(container, 'APA 7th edition').className).toContain(
            'bg-[var(--gnosi-primary)]/10',
        );

        setInputValue(search, 'chicago');
        expect(container.textContent).not.toContain('APA 7th edition');
        const chicago = findButton(container, 'Chicago Author-Date');
        act(() => {
            chicago.click();
        });

        expect(onChange).toHaveBeenCalledWith('chicago-author-date');
    });

    it('uploads, invalidates, refreshes, and selects the new style', async () => {
        const uploaded = {
            file: 'custom.csl',
            id: 'custom',
            title: 'Custom Style',
        };
        const refreshed = [
            ...styles,
            { file: 'custom.csl', id: 'custom', label: 'Custom Style', locale: 'en-US' },
        ];
        fetchAvailableStylesMock
            .mockResolvedValueOnce(styles)
            .mockResolvedValueOnce(refreshed);
        uploadCslStyleMock.mockResolvedValue(uploaded);
        const onChange = vi.fn<NonNullable<CslStylePickerProps['onChange']>>();
        await renderPicker({ onChange, value: 'apa' });

        const fileInput = container.querySelector('input[type="file"]');
        if (!(fileInput instanceof HTMLInputElement)) throw new Error('Missing upload input');
        const file = new File(['<style/>'], 'custom.csl', {
            type: 'application/xml',
        });
        Object.defineProperty(fileInput, 'files', {
            configurable: true,
            value: [file],
        });
        await act(async () => {
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(uploadCslStyleMock).toHaveBeenCalledWith(file);
        expect(invalidateCacheMock).toHaveBeenCalledOnce();
        expect(fetchAvailableStylesMock.mock.calls).toEqual([
            [{ force: false }],
            [{ force: true }],
        ]);
        expect(onChange).toHaveBeenCalledWith('custom');
        expect(successToastMock).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Custom Style');
    });
});
