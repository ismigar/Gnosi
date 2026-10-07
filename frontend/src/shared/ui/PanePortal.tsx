import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PaneVisibilityContext } from './PaneVisibility';

// Menus rendered at document.body belong to their document tab too. Keeping
// their contents mounted preserves drafts while hiding their native UI.
function PanePortal({ children, container }: { readonly children: ReactNode; readonly container: Element | DocumentFragment }) {
  const visible = useContext(PaneVisibilityContext);
  return createPortal(visible === undefined ? children : <div
    data-document-pane-portal
    inert={!visible}
    aria-hidden={!visible || undefined}
    style={{ display: visible ? 'contents' : 'none' }}
  >{children}</div>, container);
}

export function createPanePortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null) {
  return <PanePortal key={key} container={container}>{children}</PanePortal>;
}
