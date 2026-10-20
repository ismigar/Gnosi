import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';

it('provides a native disclosure button and makes collapsed controls inert', () => {
    const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
        act(() => { root.render(<CollapsibleSection title="Forces"><button type="button">Gravity</button></CollapsibleSection>); });
        const header = container.querySelector<HTMLButtonElement>('.collapsible-header');
        const content = header?.nextElementSibling;
        expect(header).toBeInstanceOf(HTMLButtonElement);
        expect(header?.getAttribute('aria-expanded')).toBe('false');
        expect(header?.getAttribute('aria-controls')).toBe(content?.id);
        expect(content?.hasAttribute('inert')).toBe(true);
        act(() => { header?.click(); });
        expect(header?.getAttribute('aria-expanded')).toBe('true');
        expect(content?.hasAttribute('inert')).toBe(false);
        act(() => { header?.click(); });
        expect(content?.hasAttribute('inert')).toBe(true);
    } finally {
        act(() => { root.unmount(); });
        delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
    }
});
