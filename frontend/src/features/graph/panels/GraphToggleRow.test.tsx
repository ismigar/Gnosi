import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GraphToggleRow } from './GraphToggleRow';

it('keeps a fragment label clickable and names the single switch from its visible text', () => {
    const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const onChange = vi.fn();
    try {
        act(() => { root.render(<GraphToggleRow active={false} onChange={onChange}><>📄 <span>Wiki Pages</span></></GraphToggleRow>); });
        const control = container.querySelector('[role="switch"]');
        expect(control).toBeInstanceOf(HTMLButtonElement);
        expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
        expect(control?.getAttribute('aria-checked')).toBe('false');
        expect(control?.hasAttribute('aria-label')).toBe(false);
        expect(control?.textContent).toContain('Wiki Pages');
        act(() => { container.querySelector('.graph-switch-label span')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(onChange).toHaveBeenCalledOnce();
        act(() => { root.render(<GraphToggleRow active label="Wiki Pages" onChange={onChange}>Wiki Pages</GraphToggleRow>); });
        expect(control?.getAttribute('aria-checked')).toBe('true');
    } finally {
        act(() => { root.unmount(); });
        delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
    }
});
