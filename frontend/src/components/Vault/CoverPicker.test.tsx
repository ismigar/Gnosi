import { act, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { toast } from '../../lib/toast';
import {
    searchUnsplashCovers,
    uploadVaultCover,
} from '../../shared/api/vault-icons';
import { CoverPicker, type CoverPickerProps } from './CoverPicker';


interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}


const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;


vi.mock('../../hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));


vi.mock('../../lib/notifyError', () => ({ logError: vi.fn() }));


vi.mock('../../lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));


vi.mock('../../shared/api/vault-icons', () => ({
    searchUnsplashCovers: vi.fn(),
    uploadVaultCover: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string): string => key,
    }),
}));


const searchUnsplashCoversMock = vi.mocked(searchUnsplashCovers);
const uploadVaultCoverMock = vi.mocked(uploadVaultCover);
const successToastMock = vi.mocked(toast.success);


let container: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;
let triggerRef: RefObject<HTMLElement | null>;


function requiredButton(label: string): HTMLButtonElement {
    const button = [...document.body.querySelectorAll('button')]
        .find((candidate) => candidate.textContent.includes(label));
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Missing button: ${label}`);
    }
    return button;
}


function requiredInput(selector: string): HTMLInputElement {
    const input = document.body.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`Missing input: ${selector}`);
    }
    return input;
}


function setInputValue(input: HTMLInputElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set?.bind(input);
    if (!setValue) throw new Error('Missing native input value setter');
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


function click(element: HTMLElement): void {
    act(() => {
        element.click();
    });
}


async function flushPromises(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}


async function renderPicker(
    overrides: Partial<CoverPickerProps> = {},
): Promise<{
    readonly onClose: ReturnType<typeof vi.fn<() => void>>;
    readonly onSelectCover: ReturnType<typeof vi.fn<(cover: string) => void>>;
}> {
    const onClose = vi.fn<() => void>();
    const onSelectCover = vi.fn<(cover: string) => void>();
    const props: CoverPickerProps = {
        isOpen: true,
        onClose,
        onSelectCover,
        triggerRef,
        ...overrides,
    };
    await act(async () => {
        root.render(<CoverPicker {...props} />);
        await Promise.resolve();
    });
    return { onClose, onSelectCover };
}


beforeEach(() => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    trigger = document.createElement('button');
    document.body.appendChild(trigger);
    triggerRef = { current: trigger };
    vi.spyOn(trigger, 'getBoundingClientRect')
        .mockReturnValue(new DOMRect(100, 40, 50, 30));
    searchUnsplashCoversMock.mockReset().mockResolvedValue({
        results: [],
        total_pages: 0,
    });
    uploadVaultCoverMock.mockReset();
    successToastMock.mockReset();
});


afterEach(() => {
    vi.useRealTimers();
    act(() => {
        root.unmount();
    });
    container.remove();
    trigger.remove();
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});


describe('CoverPicker', () => {
    it('renders in the portal at the trigger position and selects a gallery cover', async () => {
        const { onClose, onSelectCover } = await renderPicker();
        const panel = document.body.querySelector('.fixed.w-96');
        expect(panel).toBeInstanceOf(HTMLDivElement);
        if (!(panel instanceof HTMLDivElement)) return;
        expect(panel.style.top).toBe('78px');
        expect(panel.style.right).toBe(`${String(window.innerWidth - 150)}px`);

        const image = document.body.querySelector('img[alt="cover option"]');
        if (!(image instanceof HTMLImageElement) || !(image.parentElement instanceof HTMLDivElement)) {
            throw new Error('Missing gallery cover');
        }
        click(image.parentElement);
        expect(onSelectCover).toHaveBeenCalledOnce();
        expect(onSelectCover.mock.calls[0]?.[0].includes('images.unsplash.com'))
            .toBe(true);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('applies a trimmed link with Enter and clears an existing cover', async () => {
        const first = await renderPicker();
        click(requiredButton('cover_picker.tabs.link'));
        const input = requiredInput('input[placeholder="https://..."]');
        setInputValue(input, '  https://example.test/cover.jpg  ');
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Enter',
            }));
        });
        expect(first.onSelectCover).toHaveBeenCalledWith('https://example.test/cover.jpg');
        expect(first.onClose).toHaveBeenCalledOnce();

        const second = await renderPicker({ currentCover: 'current.jpg' });
        click(requiredButton('cover_picker.delete_button'));
        expect(second.onSelectCover).toHaveBeenCalledWith('');
        expect(second.onClose).toHaveBeenCalledOnce();
    });

    it('uploads a chosen file and resets the input after success', async () => {
        uploadVaultCoverMock.mockResolvedValue({
            path: 'Assets/cover.png',
            url: '/api/vault/files/cover.png',
        });
        const { onClose, onSelectCover } = await renderPicker();
        click(requiredButton('cover_picker.tabs.upload'));
        const input = requiredInput('input[type="file"]');
        const file = new File(['cover'], 'cover.png', { type: 'image/png' });
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: {
                item: (index: number): File | null => index === 0 ? file : null,
                length: 1,
            },
        });
        act(() => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await flushPromises();

        expect(uploadVaultCoverMock).toHaveBeenCalledWith(file);
        expect(onSelectCover).toHaveBeenCalledWith('/api/vault/files/cover.png');
        expect(onClose).toHaveBeenCalledOnce();
        expect(successToastMock).toHaveBeenCalledWith('cover_picker.toast.upload_success');
        expect(input.value).toBe('');
    });

    it('debounces Unsplash search and selects a result', async () => {
        vi.useFakeTimers();
        searchUnsplashCoversMock.mockResolvedValue({
            results: [{
                author: 'Author',
                author_url: 'https://example.test/author',
                id: 'photo-1',
                thumb: 'https://example.test/thumb.jpg',
                url: 'https://example.test/full.jpg',
            }],
            total_pages: 1,
        });
        const { onClose, onSelectCover } = await renderPicker();
        click(requiredButton('cover_picker.tabs.unsplash'));
        setInputValue(
            requiredInput('input[placeholder="cover_picker.search_placeholder"]'),
            '  forest  ',
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        await flushPromises();

        expect(searchUnsplashCoversMock).toHaveBeenCalledWith('forest');
        const result = document.body.querySelector('img[alt="unsplash result"]');
        if (!(result instanceof HTMLImageElement) || !(result.parentElement instanceof HTMLDivElement)) {
            throw new Error('Missing Unsplash result');
        }
        click(result.parentElement);
        expect(onSelectCover).toHaveBeenCalledWith('https://example.test/full.jpg');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes only for pointer presses outside the picker and trigger', async () => {
        const { onClose } = await renderPicker();
        act(() => {
            trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(onClose).not.toHaveBeenCalled();
        act(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
