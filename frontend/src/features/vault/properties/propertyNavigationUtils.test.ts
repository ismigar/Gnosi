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
    if (!panel) throw new Error('Expected the property panel fixture.');
    const row = panel.querySelectorAll<HTMLElement>('[data-prop-row]')[1];
    if (!row) throw new Error('Expected the quoted property row fixture.');
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    Object.defineProperty(row, 'focus', { configurable: true, value: focus });
    Object.defineProperty(row, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    expect(focusPropertyRow(panel, 'Title "quoted"')).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  it('does nothing when the property row is not rendered', () => {
    document.body.innerHTML = '<div id="panel"></div>';

    expect(
      focusPropertyRow(document.getElementById('panel'), 'Missing'),
    ).toBe(false);
  });
});
