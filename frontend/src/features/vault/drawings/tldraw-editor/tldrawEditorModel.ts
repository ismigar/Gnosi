import type { TLShapeId } from '@bigbluebutton/tldraw';
import type {
    CanvasShapeRecord,
    DroppedCanvasNote,
    SelectedCanvasPage,
} from './tldrawEditorTypes';

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
