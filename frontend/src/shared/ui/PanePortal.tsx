import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PaneVisibilityContext } from './PaneVisibility';
import { ModalLayerContext, modalPopoverStyles } from './modalLayers';

// Menus rendered at document.body belong to their document tab too. Keeping
// their contents mounted preserves drafts while hiding their native UI.
export function PanePortal({ children, container }: { readonly children: ReactNode; readonly container: Element | DocumentFragment }) {
  const visible = useContext(PaneVisibilityContext);
  const modal = useContext(ModalLayerContext);
  return createPortal(visible === undefined && modal === null ? children : <div
    data-document-pane-portal
    data-gnosi-modal-context={modal ? 'true' : undefined}
    inert={visible === false}
    aria-hidden={visible === false || undefined}
    style={{ display: visible === false ? 'none' : 'contents', ...(modal ? modalPopoverStyles(modal) : {}) }}
  >{children}</div>, container);
}
