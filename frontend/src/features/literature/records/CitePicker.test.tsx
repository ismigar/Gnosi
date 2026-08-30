import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CitePicker } from './CitePicker';


const mocks = vi.hoisted(() => ({
    logError: vi.fn(),
    searchCitations: vi.fn(),
}));
const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { readonly defaultValue?: string }) => (
            options?.defaultValue ?? key
        ),
    }),
}));

vi.mock('../../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: vi.fn(),
}));

vi.mock('../../../shared/notifications/notifyError', () => ({
    logError: mocks.logError,
}));

vi.mock('../../../shared/api/citations', () => ({
    searchCitations: mocks.searchCitations,
}));


function setInputValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Input value setter is unavailable');
    const setValue = descriptor.set.bind(input);
    act(() => {
        setValue(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}


describe('CitePicker', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        Element.prototype.scrollIntoView = vi.fn();
        mocks.searchCitations.mockResolvedValue([
            {
                author: 'Weber',
                citation_key: 'weber1905',
                folder: null,
                id: 'page-1',
                title: 'The Protestant Ethic',
                year: '1905',
            },
            {
                author: 'Arendt',
                citation_key: 'arendt1958',
                folder: null,
                id: 'page-2',
                title: 'The Human Condition',
                year: '1958',
            },
        ]);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        document.getElementById('cite-picker-root')?.remove();
        vi.useRealTimers();
        vi.clearAllMocks();
        delete reactTestGlobal.IS_REACT_ACT_ENVIRONMENT;
    });

    it('does not render the open picker while closed', () => {
        act(() => {
            root.render(<CitePicker isOpen={false} onClose={vi.fn()} />);
        });
        expect(document.querySelector('[data-idx]')).toBeNull();
    });

    it('loads citations and selects the active result with the keyboard', async () => {
        const onClose = vi.fn();
        const onSelect = vi.fn();
        act(() => {
            root.render(<CitePicker isOpen onClose={onClose} onSelect={onSelect} />);
        });
        await act(async () => {
            vi.advanceTimersByTime(200);
            await Promise.resolve();
            await Promise.resolve();
        });
        const input = document.querySelector<HTMLInputElement>('input[type="text"]');
        if (!input) throw new Error('Citation search input did not render');
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        });
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });

        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            citation_key: 'arendt1958',
        }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('aborts an in-flight search when the picker closes', async () => {
        let capturedSignal: AbortSignal | undefined;
        mocks.searchCitations.mockImplementation((
            _query: string,
            _limit: number,
            signal: AbortSignal,
        ) => {
            capturedSignal = signal;
            return new Promise(() => undefined);
        });
        act(() => {
            root.render(<CitePicker isOpen onClose={vi.fn()} />);
        });
        await act(async () => {
            vi.advanceTimersByTime(200);
            await Promise.resolve();
        });
        act(() => {
            root.render(<CitePicker isOpen={false} onClose={vi.fn()} />);
        });

        expect(capturedSignal?.aborted).toBe(true);
    });

    it('debounces the latest typed query', async () => {
        act(() => {
            root.render(<CitePicker isOpen onClose={vi.fn()} />);
        });
        const input = document.querySelector<HTMLInputElement>('input[type="text"]');
        if (!input) throw new Error('Citation search input did not render');
        setInputValue(input, 'weber');
        await act(async () => {
            vi.advanceTimersByTime(199);
            await Promise.resolve();
        });
        expect(mocks.searchCitations).not.toHaveBeenCalled();
        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mocks.searchCitations).toHaveBeenCalledWith(
            'weber',
            30,
            expect.any(AbortSignal),
        );
    });
});
