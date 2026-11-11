import { useContext, useMemo, type ReactNode } from 'react';
import { PanePortal } from './PanePortal';
import { ModalLayerContext, nestedModalLayer, modalZIndex, type ModalLayer } from './modalLayers';
import './ModalPortal.css';

/** Keep blocking dialogs outside editor/scroll stacking contexts and with their document pane. */
export function ModalPortal({ children, layer = 'modal' }: {
    readonly children: ReactNode;
    readonly layer?: ModalLayer;
}) {
    const parent = useContext(ModalLayerContext);
    const state = useMemo(() => nestedModalLayer(layer, parent), [layer, parent]);
    return <ModalLayerContext.Provider value={state}><PanePortal container={document.body}>
        <div data-gnosi-modal-layer={state.layer} style={{ position: 'fixed', inset: 0, zIndex: modalZIndex(state), pointerEvents: 'none' }}
            onClick={event => { event.stopPropagation(); }}
            onDoubleClick={event => { event.stopPropagation(); }}
            onMouseDown={event => { event.stopPropagation(); }}
            onPointerDown={event => { event.stopPropagation(); }}
            onContextMenu={event => { event.stopPropagation(); }}>
            {children}
        </div>
    </PanePortal></ModalLayerContext.Provider>;
}
