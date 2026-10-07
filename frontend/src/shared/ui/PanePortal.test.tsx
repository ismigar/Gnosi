import { useEffect, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { useModalKeyboard, hasOpenModal } from '../hooks/useModalKeyboard';
import { PaneVisibilityContext } from './PaneVisibility';
import { createPanePortal } from './createPanePortal';

describe('document pane overlays', () => {
  it('hides a tab-owned portal and releases its keyboard layer while retaining its draft', () => {
    const mount = vi.fn(); const unmount = vi.fn();
    function Menu() {
      const ref = useRef<HTMLDivElement>(null);
      useEffect(() => { mount(); return unmount; }, []);
      useModalKeyboard({ isOpen: true, onClose: () => undefined, containerRef: ref });
      return createPanePortal(<div ref={ref} data-pane-menu><input defaultValue="Draft" /></div>, document.body);
    }
    const tree = (visible: boolean) => <PaneVisibilityContext.Provider value={visible}><Menu /></PaneVisibilityContext.Provider>;
    const mounted = mountTestComponent(tree(true));
    const menu = document.querySelector('[data-pane-menu]');
    const input = menu?.querySelector('input');
    if (!input) throw new Error('Menu was not portaled');
    input.value = 'Unsubmitted changes';
    expect(hasOpenModal()).toBe(true);
    mounted.render(tree(false));
    expect(menu?.parentElement?.style.display).toBe('none');
    expect(menu?.parentElement?.hasAttribute('inert')).toBe(true);
    expect(hasOpenModal()).toBe(false);
    expect(unmount).not.toHaveBeenCalled();
    mounted.render(tree(true));
    expect(menu?.parentElement?.style.display).toBe('contents');
    expect(document.querySelector('[data-pane-menu]')).toBe(menu);
    expect(input.value).toBe('Unsubmitted changes');
    expect(mount).toHaveBeenCalledOnce();
    expect(hasOpenModal()).toBe(true);
    mounted.unmount();
    expect(hasOpenModal()).toBe(false);
  });

  it('keeps the existing portal DOM outside document tabs', () => {
    mountTestComponent(createPanePortal(<div data-unscoped-menu />, document.body));
    expect(document.querySelector('[data-unscoped-menu]')?.parentElement).toBe(document.body);
  });
});
