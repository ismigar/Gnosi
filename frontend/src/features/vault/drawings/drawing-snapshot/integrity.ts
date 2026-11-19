import { type TLRecord } from '@bigbluebutton/tldraw';
import { isRecord } from '../tldraw-editor/tldrawEditorModel';

/** Check the relationships that the SDK's per-record validators cannot check. */
export function validateDrawingRecords(records: Record<string, TLRecord>): void {
    const pages = new Map<string, string>();
    const shapes = Object.values(records).filter(record => record.typeName === 'shape');
    for (const record of Object.values(records)) {
        if ('meta' in record && !isRecord(record.meta)) throw new Error('Invalid drawing record metadata');
        if (record.typeName === 'page') pages.set(record.id, record.id);
    }
    if (!pages.size || records['document:document']?.typeName !== 'document') {
        throw new Error('Drawing has no document or page');
    }
    for (const shape of shapes) {
        let parent: string = shape.id;
        const visited = new Set<string>();
        let page = pages.get(parent);
        while (page === undefined) {
            const ancestor = records[parent];
            if (ancestor?.typeName !== 'shape' || visited.has(parent)) throw new Error('Invalid drawing hierarchy');
            visited.add(parent);
            parent = ancestor.parentId;
            page = pages.get(parent);
        }
        for (const id of visited) pages.set(id, page);
    }
    for (const shape of shapes) {
        const props: unknown = shape.props;
        if (!isRecord(props)) throw new Error('Invalid drawing shape properties');
        if (typeof props.assetId === 'string') {
            const asset = records[props.assetId];
            if (asset?.typeName !== 'asset' || asset.type !== shape.type) throw new Error('Missing drawing asset');
        }
        if (shape.type === 'arrow') {
            for (const end of [props.start, props.end]) {
                if (isRecord(end) && end.type === 'binding' &&
                    (typeof end.boundShapeId !== 'string' || end.boundShapeId === shape.id ||
                        records[end.boundShapeId]?.typeName !== 'shape' || pages.get(end.boundShapeId) !== pages.get(shape.id))) {
                    throw new Error('Invalid arrow target');
                }
            }
        }
        if (shape.type === 'draw' || shape.type === 'highlight') {
            if (!Array.isArray(props.segments) || !props.segments.length || props.segments.some(
                (segment: unknown) => !isRecord(segment) || !Array.isArray(segment.points) || !segment.points.length,
            )) throw new Error('Empty drawing stroke');
        }
        if (shape.type === 'json-canvas-node') {
            const node: unknown = typeof props.data === 'string' ? JSON.parse(props.data) : null;
            const textFields = ['text', 'file', 'url', 'label', 'subpath', 'background', 'color'];
            if (!isRecord(node) || !['text', 'file', 'link', 'group'].includes(String(node.type)) ||
                textFields.some(key => key in node && typeof node[key] !== 'string')) {
                throw new Error('Invalid JSON Canvas node');
            }
        }
    }
}
