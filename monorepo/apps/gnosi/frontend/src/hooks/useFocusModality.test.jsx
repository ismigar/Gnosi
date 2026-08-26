import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFocusModality } from './useFocusModality';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useFocusModality();
  return null;
}

describe('useFocusModality', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute('data-focus-modality');
  });

  it('distinguishes pointer focus from keyboard focus', () => {
    act(() => root.render(<Harness />));
    const documentRoot = document.documentElement;

    expect(documentRoot.getAttribute('data-focus-modality')).toBe('keyboard');

    act(() => document.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(documentRoot.getAttribute('data-focus-modality')).toBe('pointer');

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(documentRoot.getAttribute('data-focus-modality')).toBe('keyboard');
  });

  it('ignores modifier-only shortcuts', () => {
    act(() => root.render(<Harness />));
    const documentRoot = document.documentElement;
    act(() => document.dispatchEvent(new Event('pointerdown', { bubbles: true })));

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Meta',
      metaKey: true,
      bubbles: true,
    })));

    expect(documentRoot.getAttribute('data-focus-modality')).toBe('pointer');
  });
});
