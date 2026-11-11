import { createContext, type CSSProperties } from 'react';

const LAYERS = ['modal', 'confirm', 'command', 'presentation'] as const;
const TOKENS = {
    modal: 'var(--z-modal)', confirm: 'var(--z-confirm-modal)',
    command: 'var(--z-command)', presentation: 'var(--z-presentation)',
} as const;
export type ModalLayer = typeof LAYERS[number];
export interface ModalLayerState { readonly layer: ModalLayer; readonly depth: number }
export const ModalLayerContext = createContext<ModalLayerState | null>(null);

export function nestedModalLayer(layer: ModalLayer, parent: ModalLayerState | null): ModalLayerState {
    return {
        layer: parent && LAYERS.indexOf(parent.layer) > LAYERS.indexOf(layer) ? parent.layer : layer,
        depth: parent ? parent.depth + 1 : 0,
    };
}

export function modalZIndex(state: ModalLayerState, offset = 0): string {
    const level = state.depth + offset;
    return level ? `calc(${TOKENS[state.layer]} + ${String(level)})` : TOKENS[state.layer];
}

export function modalPopoverStyles(state: ModalLayerState): CSSProperties & {
    '--z-overlay': string; '--z-popover': string; '--z-modal-dropdown': string;
} {
    return { '--z-overlay': modalZIndex(state, 40), '--z-popover': modalZIndex(state, 50), '--z-modal-dropdown': modalZIndex(state, 50) };
}
