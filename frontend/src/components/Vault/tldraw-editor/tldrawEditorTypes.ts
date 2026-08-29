import type { Editor, TLShapeId, TLStore } from 'tldraw';

export type DrawingLoadState = 'error' | 'incompatible' | 'loading' | 'ready';

export interface TldrawVaultNote {
    readonly id: string;
    readonly title?: string | null;
    readonly [key: string]: unknown;
}

export interface TldrawVaultTable {
    readonly id?: string | null;
    readonly name?: string | null;
    readonly [key: string]: unknown;
}

export interface TldrawEditorProps {
    readonly allNotes?: readonly TldrawVaultNote[];
    readonly drawingId?: string | null;
    readonly onClose: () => void;
    readonly onOpenPage?: ((pageId: string) => void) | null;
    readonly onSaveSuccess?: (() => void) | null;
    readonly tables?: readonly TldrawVaultTable[];
    readonly title?: string | null;
}

export interface SelectedCanvasPage {
    readonly id: string;
    readonly title: string;
}

export interface DroppedCanvasNote {
    readonly id: string;
    readonly title?: string;
}

export interface CanvasPoint {
    readonly x: number;
    readonly y: number;
}

export interface CanvasBounds extends CanvasPoint {
    readonly maxY: number;
}

export interface CanvasImageResult {
    readonly blob?: Blob;
}

export interface CanvasShapeRecord {
    readonly id: TLShapeId;
    readonly meta?: unknown;
    readonly props: unknown;
    readonly type: string;
}

export interface CanvasEditor {
    readonly store: TLStore;
    createShape: (shape: unknown) => void;
    deleteShapes: (ids: readonly TLShapeId[]) => void;
    deselectAll: () => void;
    getCurrentPageBounds: () => CanvasBounds | null;
    getCurrentPageShapeIds: () => ReadonlySet<TLShapeId>;
    getCurrentPageShapes: () => readonly CanvasShapeRecord[];
    getSelectedShapeIds: () => readonly TLShapeId[];
    getSelectionPageBounds: () => CanvasBounds | null;
    getShape: (id: TLShapeId) => CanvasShapeRecord | undefined;
    getViewportPageBounds: () => { readonly center: CanvasPoint };
    screenToPage: (point: CanvasPoint) => CanvasPoint;
    select: (id: TLShapeId) => void;
    toImage: (
        ids: readonly TLShapeId[],
        options: Readonly<Record<string, boolean | number | string>>,
    ) => Promise<CanvasImageResult | null>;
}

export function canvasEditorFrom(editor: Editor): CanvasEditor {
    return editor as unknown as CanvasEditor;
}
