import { createElement, type ReactNode } from 'react';
import { PanePortal } from './PanePortal';

export function createPanePortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null) {
  return createElement(PanePortal, { key, container, children });
}
