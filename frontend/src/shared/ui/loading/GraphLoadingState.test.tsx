import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GraphLoadingState } from './GraphLoadingState';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback || key,
    }),
}));

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

const render = (element: ReactElement): HTMLDivElement => {
    mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);
    act(() => {
        mountedRoot?.render(element);
    });
    return mountedContainer;
};

beforeAll(() => {
    const reactTestGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
    };
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    if (mountedRoot) {
        act(() => {
            mountedRoot?.unmount();
        });
    }
    mountedContainer?.remove();
    mountedRoot = null;
    mountedContainer = null;
});

describe('GraphLoadingState', () => {
    it('uses an indeterminate progress bar while the route chunk loads', () => {
        const container = render(<GraphLoadingState />);
        const progressbar = container.querySelector('[role="progressbar"]');
        const progressFill = progressbar?.firstElementChild;
        if (!(progressFill instanceof HTMLElement)) {
            throw new Error('Expected progress fill element');
        }

        expect(container.textContent).toContain('Loading...');
        expect(progressbar?.getAttribute('aria-valuenow')).toBeNull();
        expect(progressFill.style.width).toBe('35%');
    });

    it('exposes normalized progress while graph data loads', () => {
        const container = render(<GraphLoadingState progress={70} />);
        const progressbar = container.querySelector('[role="progressbar"]');
        const progressFill = progressbar?.firstElementChild;
        if (!(progressFill instanceof HTMLElement)) {
            throw new Error('Expected progress fill element');
        }

        expect(progressbar?.getAttribute('aria-valuenow')).toBe('70');
        expect(progressFill.style.width).toBe('70%');
    });
});
