import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DateMentionInline, { type DateMentionInlineProps } from './DateMentionInline';

interface ReactTestGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const reactTestGlobal = globalThis as typeof globalThis & ReactTestGlobal;

vi.mock('../../../shared/i18n/i18n', () => ({
    default: {
        language: 'en',
        t: (key: string, fallback: string): string => fallback || key,
    },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string): string => fallback || key,
    }),
}));

describe('DateMentionInline', () => {
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

    it('opens the date editor and saves the existing reminder contract', async () => {
        const updateInlineContent = vi.fn<DateMentionInlineProps['updateInlineContent']>();
        await act(async () => {
            root.render(
                <DateMentionInline
                    inlineContent={{ props: { date: '2026-06-25', time: '09:00' } }}
                    updateInlineContent={updateInlineContent}
                />,
            );
            await Promise.resolve();
        });

        const chip = container.querySelector('.bn-dateref > span');
        if (!(chip instanceof HTMLSpanElement)) throw new Error('Missing date chip');
        act(() => {
            chip.click();
        });

        const popover = document.querySelector('[data-gnosi-portal="dateref"]');
        if (!(popover instanceof HTMLDivElement)) throw new Error('Missing date popover');
        const inputs = popover.querySelectorAll('input');
        const dateInput = inputs.item(0);
        const timeInput = inputs.item(1);
        expect(dateInput.value).toBe('2026-06-25');
        expect(timeInput.value).toBe('09:00');

        const saveButton = [...popover.querySelectorAll('button')]
            .find((button) => button.textContent.includes('Save'));
        if (!(saveButton instanceof HTMLButtonElement)) throw new Error('Missing save button');
        act(() => {
            saveButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });

        expect(updateInlineContent).toHaveBeenCalledWith({
            type: 'dateref',
            props: { date: '2026-06-25', time: '09:00' },
        });
        expect(document.querySelector('[data-gnosi-portal="dateref"]')).toBeNull();
    });
});
