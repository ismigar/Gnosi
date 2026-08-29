import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { VaultChart } from './VaultChart';


vi.mock('./schemaUtils', () => ({
    getFieldType: (_schema: unknown, field: string) => field === 'date' ? 'date' : 'text',
    getMetaValue: (note: Readonly<Record<string, unknown>>, _schema: unknown, field: string) => note[field],
}));


vi.mock('react-i18next', () => ({
    Trans: ({ defaults }: { defaults: string }) => <span>{defaults}</span>,
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
});


function render(element: ReactElement): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ container, root });
    act(() => { root.render(element); });
}


describe('VaultChart', () => {
    it('prompts for configuration when no category field is selected', () => {
        render(<VaultChart />);
        expect(document.body.textContent).toContain('Configure the chart');
        expect(document.body.querySelector('svg')).not.toBeNull();
    });

    it('renders aggregated vertical bars in descending value order', () => {
        render(<VaultChart
            activeView={{ aggregation: 'sum', chartType: 'bar', xField: 'category', yField: 'amount' }}
            notes={[
                { amount: 2, category: 'Small' },
                { amount: 9, category: 'Large' },
            ]}
        />);

        const titles = [...document.body.querySelectorAll('svg title')]
            .map((title) => title.textContent);
        expect(titles).toEqual(['Large: 9', 'Small: 2']);
    });

    it('renders a donut using only positive values', () => {
        render(<VaultChart
            activeView={{ aggregation: 'sum', chartType: 'donut', xField: 'category', yField: 'amount' }}
            notes={[
                { amount: 4, category: 'Visible' },
                { amount: -3, category: 'Hidden' },
            ]}
        />);

        expect(document.body.textContent).toContain('Visible');
        expect(document.body.textContent).not.toContain('Hidden');
        expect(document.body.querySelectorAll('path').length).toBe(1);
    });

    it('shows an empty state when a pie has no positive values', () => {
        render(<VaultChart
            activeView={{ aggregation: 'sum', chartType: 'pie', xField: 'category', yField: 'amount' }}
            notes={[{ amount: 0, category: 'Zero' }]}
        />);
        expect(document.body.textContent).toContain('No data to display.');
    });
});
