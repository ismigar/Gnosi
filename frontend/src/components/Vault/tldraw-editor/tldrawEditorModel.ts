import type {
    TLEditorSnapshot,
    TLShapeId,
    TLStoreSnapshot,
} from 'tldraw';

import type { DrawingDocument } from '../../../shared/api/drawings';
import type {
    CanvasShapeRecord,
    DroppedCanvasNote,
    SelectedCanvasPage,
} from './tldrawEditorTypes';

export type LoadableDrawingSnapshot = Partial<TLEditorSnapshot> | TLStoreSnapshot;

export type DrawingSnapshotAssessment =
    | { readonly kind: 'empty' }
    | { readonly kind: 'incompatible' }
    | {
        readonly kind: 'loadable';
        readonly snapshot: LoadableDrawingSnapshot;
    };

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assessDrawingSnapshot(data: unknown): DrawingSnapshotAssessment {
    if (!isRecord(data) || Object.keys(data).length === 0) return { kind: 'empty' };
    if (!('store' in data || 'document' in data || 'session' in data)) {
        return { kind: 'incompatible' };
    }

    const document = data.document;
    if (isRecord(document) && document.store) {
        return {
            kind: 'loadable',
            snapshot: {
                schema: document.schema,
                store: document.store,
            } as LoadableDrawingSnapshot,
        };
    }
    if (document) {
        return {
            kind: 'loadable',
            snapshot: {
                schema: data.schema,
                store: document,
            } as LoadableDrawingSnapshot,
        };
    }
    return {
        kind: 'loadable',
        snapshot: data as LoadableDrawingSnapshot,
    };
}

export function drawingDocumentFromSnapshot(snapshot: unknown): DrawingDocument {
    if (!isRecord(snapshot)) {
        throw new TypeError('Tldraw returned a non-object snapshot');
    }
    return snapshot;
}

function recordString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    return typeof value === 'string' ? value : '';
}

export function parseDroppedCanvasNote(value: string): DroppedCanvasNote {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new TypeError('Invalid dropped Vault note');
    const id = recordString(parsed, 'id');
    if (!id) throw new TypeError('Dropped Vault note has no id');
    return {
        id,
        title: recordString(parsed, 'title') || undefined,
    };
}

export function selectedPageFromShape(
    shape: CanvasShapeRecord | undefined,
    fallbackTitle: string,
): SelectedCanvasPage | null {
    if (!shape || !isRecord(shape.meta)) return null;
    const id = recordString(shape.meta, 'pageId');
    if (!id) return null;
    return {
        id,
        title: recordString(shape.meta, 'pageTitle') || fallbackTitle,
    };
}

export function pageCardIdsForDeletedPage(
    shapes: readonly CanvasShapeRecord[],
    pageId: string,
): TLShapeId[] {
    const ids: TLShapeId[] = [];
    for (const shape of shapes) {
        if (shape.type !== 'page-card' || !isRecord(shape.props)) continue;
        if (recordString(shape.props, 'pageId') === pageId) ids.push(shape.id);
    }
    return ids;
}

export function isAbortError(error: unknown): boolean {
    return isRecord(error) && error.name === 'AbortError';
}
