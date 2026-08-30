import type { ComponentType, Context, ReactNode } from 'react';
import {
    defaultShapeUtils,
    type TLAnyShapeUtilConstructor,
} from 'tldraw';

import {
    CanvasPageContext,
    PageCardShapeUtil,
} from '../canvasPageCardShape';
import { GlobalSearchModal } from '../../../../shared/page-search/GlobalSearchModal';
import type {
    TldrawVaultNote,
    TldrawVaultTable,
} from './tldrawEditorTypes';

interface CanvasPageContextValue {
    readonly onOpenPage?: ((pageId: string) => void) | null;
}

interface GlobalSearchModalProps {
    readonly allNotes: readonly TldrawVaultNote[];
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly onNoteSelect: (pageId: string) => void;
    readonly tables: readonly TldrawVaultTable[];
}

interface CanvasPageProviderProps {
    readonly children: ReactNode;
    readonly value: CanvasPageContextValue;
}

export const CANVAS_SHAPE_UTILS: readonly TLAnyShapeUtilConstructor[] = [
    ...defaultShapeUtils,
    PageCardShapeUtil,
];

const typedCanvasContext = CanvasPageContext as unknown as Context<CanvasPageContextValue>;
export const CanvasPageProvider = typedCanvasContext.Provider as ComponentType<CanvasPageProviderProps>;

export const TldrawGlobalSearchModal = GlobalSearchModal as unknown as ComponentType<GlobalSearchModalProps>;
