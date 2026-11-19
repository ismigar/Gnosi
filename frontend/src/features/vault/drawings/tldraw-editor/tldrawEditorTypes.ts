import type { Editor, TLShapeId } from '@bigbluebutton/tldraw';

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

export interface CanvasShapeRecord {
    readonly id: TLShapeId;
    readonly meta?: unknown;
    readonly props: unknown;
    readonly type: string;
}

export type CanvasEditor = Editor;
