import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GraphLoadingState } from './GraphLoadingState';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallback) => fallback || key,
    }),
}));

let mountedRoot;
let mountedContainer;

const render = async element => {
    mountedContainer = document.createElement('div');
    document.body.appendChild(mountedContainer);
    mountedRoot = createRoot(mountedContainer);
    await act(async () => mountedRoot.render(element));
    return mountedContainer;
};

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (mountedRoot) await act(async () => mountedRoot.unmount());
    mountedContainer?.remove();
    mountedRoot = null;
    mountedContainer = null;
});

describe('GraphLoadingState', () => {
    it('uses an indeterminate progress bar while the route chunk loads', async () => {
        const container = await render(<GraphLoadingState />);
        const progressbar = container.querySelector('[role="progressbar"]');

        expect(container.textContent).toContain('Loading...');
        expect(progressbar?.getAttribute('aria-valuenow')).toBeNull();
        expect(progressbar?.firstElementChild?.style.width).toBe('35%');
    });

    it('exposes normalized progress while graph data loads', async () => {
        const container = await render(<GraphLoadingState progress={70} />);
        const progressbar = container.querySelector('[role="progressbar"]');

        expect(progressbar?.getAttribute('aria-valuenow')).toBe('70');
        expect(progressbar?.firstElementChild?.style.width).toBe('70%');
    });
});
