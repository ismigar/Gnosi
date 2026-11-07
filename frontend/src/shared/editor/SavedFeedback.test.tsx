import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SavedFeedback } from './SavedFeedback';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { vi.useRealTimers(); });

it('shows each save in Gnosi blue for one second without extending it on rerender', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
        await act(async () => { await Promise.resolve(); root.render(<SavedFeedback>Saved</SavedFeedback>); });
        expect(container.querySelector('[role="status"]')?.getAttribute('style')).toContain('var(--gnosi-blue)');
        await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(600); root.render(<SavedFeedback>Saved</SavedFeedback>); });
        await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(399); });
        expect(container.textContent).toBe('Saved');
        await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(1); });
        expect(container.textContent).toBe('');
        await act(async () => { await Promise.resolve(); root.render(null); });
        await act(async () => { await Promise.resolve(); root.render(<SavedFeedback>Saved again</SavedFeedback>); });
        expect(container.textContent).toBe('Saved again');
        await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(1000); });
        expect(container.textContent).toBe('');
    } finally {
        await act(async () => { await Promise.resolve(); root.unmount(); });
    }
    expect(vi.getTimerCount()).toBe(0);
});
