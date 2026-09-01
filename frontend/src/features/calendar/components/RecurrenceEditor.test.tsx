import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RecurrenceEditor } from './RecurrenceEditor';


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback ?? key,
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


describe('RecurrenceEditor', () => {
    it('renders a weekly rule and removes a selected day', () => {
        const onChange = vi.fn();
        render(<RecurrenceEditor
            onChange={onChange}
            value="FREQ=WEEKLY;BYDAY=MO,WE"
        />);

        const monday = [...document.body.querySelectorAll('button')]
            .find((button) => button.textContent === 'Mon');
        expect(monday?.className).toContain('bg-[var(--gnosi-primary)]');
        act(() => { monday?.click(); });
        expect(onChange).toHaveBeenCalledWith('FREQ=WEEKLY;BYDAY=WE');
    });

    it('emits null when recurrence is disabled', () => {
        const onChange = vi.fn();
        render(<RecurrenceEditor onChange={onChange} value="FREQ=DAILY" />);
        const select = document.body.querySelector('select');

        act(() => {
            if (!select) return;
            select.value = '';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(onChange).toHaveBeenCalledWith(null);
        expect(document.body.querySelector('input[type="radio"]')).toBeNull();
    });

    it('switches a recurrence to a count-based ending', () => {
        const onChange = vi.fn();
        render(<RecurrenceEditor onChange={onChange} value="FREQ=MONTHLY" />);
        const countRadio = document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1];

        act(() => { countRadio?.click(); });
        expect(onChange).toHaveBeenCalledWith('FREQ=MONTHLY;COUNT=10');
    });
});
