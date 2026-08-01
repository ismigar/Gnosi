import { describe, expect, it, vi } from 'vitest';

import { focusPropertyRow } from './propertyNavigationUtils';

describe('focusPropertyRow', () => {
    it('focuses the exact property and scrolls it to the nearest visible position', () => {
        document.body.innerHTML = `
            <div id="panel">
                <button data-prop-row="Àrea">Area</button>
                <button data-prop-row='Title "quoted"'>Quoted</button>
            </div>
        `;
        const panel = document.getElementById('panel');
        const row = panel.querySelectorAll('[data-prop-row]')[1];
        row.focus = vi.fn();
        row.scrollIntoView = vi.fn();

        expect(focusPropertyRow(panel, 'Title "quoted"')).toBe(true);
        expect(row.focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(row.scrollIntoView).toHaveBeenCalledWith({
            block: 'nearest',
            inline: 'nearest',
        });
    });

    it('does nothing when the property row is not rendered', () => {
        document.body.innerHTML = '<div id="panel"></div>';

        expect(focusPropertyRow(document.getElementById('panel'), 'Missing')).toBe(false);
    });
});
