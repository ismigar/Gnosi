import { defaultShapeUtils, type TLStore, type TLStoreSnapshot } from '@bigbluebutton/tldraw';
import {
    b64Vecs,
    createTLSchema,
    defaultShapeSchemas,
    type TLArrowBinding,
    type TLDrawShapeSegment,
    type TLLineShape,
    type TLRecord,
    type TLShape,
    type TLStoreSnapshot as V5Snapshot,
} from '@tldraw/tlschema';

import { isRecord } from '../tldraw-editor/tldrawEditorModel';

// Read the old data with its own published schema, including the two Gnosi extensions.
// Their props are validated against the destination store's registered shape utils.
const v5Schema = createTLSchema({
    shapes: { ...defaultShapeSchemas, 'page-card': {}, 'json-canvas-node': {} },
});
const nativePropNames = new Map(defaultShapeUtils.map(util => [util.type, Object.keys(util.props ?? {})]));

function plainText(node: unknown): string {
    if (!isRecord(node)) throw new Error('Invalid rich text node');
    if (node.type === 'text' && typeof node.text === 'string') return node.text;
    if (node.type === 'hardBreak') return '\n';
    const inline = node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock';
    const block = ['doc', 'listItem', 'bulletList', 'orderedList', 'blockquote'].includes(String(node.type));
    if (!inline && !block) throw new Error('Unsupported rich text node');
    if (node.content === undefined) return '';
    if (!Array.isArray(node.content)) throw new Error('Invalid rich text content');
    return node.content.map(plainText).join(inline ? '' : '\n');
}

function decodedPath(segment: TLDrawShapeSegment) {
    const { path, dim = 3 } = segment;
    // The codec assumes valid base64. Reject truncated paths and unknown characters before decoding.
    const padding = path.endsWith('==') ? 2 : Number(path.endsWith('='));
    const bytes = path.length / 4 * 3 - padding;
    if (path.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(path) ||
        bytes < dim * 4 || (bytes - dim * 4) % (dim * 2)) {
        throw new Error('Invalid encoded drawing stroke');
    }
    return b64Vecs.decodePoints(path, dim);
}

function pointsBeforeCompression(source: unknown) {
    if (!isRecord(source) || !('points' in source)) return undefined;
    if ('path' in source) throw new Error('Ambiguous drawing stroke data');
    if (typeof source.points === 'string') {
        // Earlier absolute Float16 triples occupied exactly eight base64 characters each.
        if (source.points.length % 8 || !/^[A-Za-z0-9+/]+$/.test(source.points)) throw new Error('Invalid legacy stroke');
        return undefined; // The v5 schema migrated this encoding.
    }
    if (!Array.isArray(source.points)) throw new Error('Invalid legacy stroke');
    return source.points.map((point: unknown) => {
        if (!isRecord(point) || typeof point.x !== 'number' || typeof point.y !== 'number' ||
            (point.z !== undefined && typeof point.z !== 'number')) throw new Error('Invalid legacy stroke point');
        return { x: point.x, y: point.y, z: point.z ?? 0.5 };
    });
}

function decodedSegment(segment: TLDrawShapeSegment, source: unknown, scaleX: number, scaleY: number) {
    // Use original uncompressed coordinates when available. Passing those through Float16 would round them.
    const coordinates = pointsBeforeCompression(source) ?? decodedPath(segment);
    const points = coordinates.map(point => ({
        x: point.x * scaleX,
        y: point.y * scaleY,
        z: point.z,
    }));
    if (points.some(point => ![point.x, point.y, point.z].every(Number.isFinite))) {
        throw new Error('Invalid drawing stroke coordinates');
    }
    return { type: segment.type, points };
}

function lineHandles(shape: TLLineShape) {
    const points = Object.values(shape.props.points).sort((a, b) => a.index < b.index ? -1 : 1);
    if (points.length < 2) throw new Error('A line needs two points');
    return Object.fromEntries(points.map((point, index) => {
        if (point.index === points[index - 1]?.index) throw new Error('Repeated line point index');
        const id = index === 0 ? 'start' : index === points.length - 1 ? 'end' : `handle:${point.index}`;
        return [id, { ...point, id, type: 'vertex', canBind: false, canSnap: true }];
    }));
}

type ArrowBindings = Partial<Record<'start' | 'end', TLArrowBinding>>;

function collectBindings(records: TLRecord[]) {
    const shapes = new Map(records.filter(record => record.typeName === 'shape').map(shape => [shape.id, shape]));
    const byArrow = new Map<string, ArrowBindings>();
    for (const record of records) {
        if (record.typeName !== 'binding') continue;
        if (shapes.get(record.fromId)?.type !== 'arrow' || !shapes.has(record.toId)) {
            throw new Error('Unsupported or disconnected drawing binding');
        }
        const ends = byArrow.get(record.fromId) ?? {};
        if (ends[record.props.terminal]) throw new Error('Duplicate arrow binding');
        ends[record.props.terminal] = record;
        byArrow.set(record.fromId, ends);
    }
    return byArrow;
}

function arrowTerminal(point: { x: number; y: number }, binding?: TLArrowBinding) {
    if (!binding) return { type: 'point', x: point.x, y: point.y };
    const { normalizedAnchor, isExact, isPrecise } = binding.props;
    return { type: 'binding', boundShapeId: binding.toId, normalizedAnchor, isExact, isPrecise };
}

function convertedShape(shape: TLShape, source: unknown, bindings?: ArrowBindings) {
    const names = nativePropNames.get(shape.type);
    if (!names) return shape; // group and Gnosi's custom shape formats are unchanged
    const props: Record<string, unknown> = { ...shape.props };
    if (props.flipX || props.flipY || (props.scale !== undefined && props.scale !== 1 && shape.type !== 'text')) {
        throw new Error('Unsupported drawing shape scale or flip');
    }
    if ('richText' in props) {
        if (!isRecord(props.richText) || props.richText.type !== 'doc') throw new Error('Invalid rich text document');
        props.text = plainText(props.richText);
    }
    if ('textAlign' in props) props.align = props.textAlign;
    switch (shape.type) {
        case 'draw':
        case 'highlight': {
            const { scaleX, scaleY, segments } = shape.props;
            const before = isRecord(source) && isRecord(source.props) && Array.isArray(source.props.segments)
                ? source.props.segments : [];
            props.segments = segments.map((segment, index) => decodedSegment(segment, before[index], scaleX, scaleY));
            break;
        }
        case 'line':
            props.handles = lineHandles(shape);
            break;
        case 'arrow':
            if (shape.props.kind !== 'arc') throw new Error('Unsupported arrow routing');
            props.start = arrowTerminal(shape.props.start, bindings?.start);
            props.end = arrowTerminal(shape.props.end, bindings?.end);
            break;
    }
    return { ...shape, props: Object.fromEntries(names.map(name => [name, props[name]])) };
}

function convertedAsset(asset: Extract<TLRecord, { typeName: 'asset' }>) {
    const names = asset.type === 'bookmark'
        ? ['title', 'description', 'image', 'src']
        : ['w', 'h', 'name', 'isAnimated', 'mimeType', 'src'];
    const props: Record<string, unknown> = { ...asset.props };
    return { ...asset, props: Object.fromEntries(names.map(name => [name, props[name]])) };
}

/** Convert document records only. The caller retains the complete source, including session and user records. */
export function convertV5Snapshot(store: TLStore, source: V5Snapshot): TLStoreSnapshot {
    const migrated = v5Schema.migrateStoreSnapshot(structuredClone(source));
    if (migrated.type !== 'success') throw new Error(`Cannot read drawing schema: ${migrated.reason}`);
    for (const record of Object.values(source.store)) {
        if (!Object.hasOwn(migrated.value, record.id)) throw new Error('Migration removed a drawing record');
    }
    const records = Object.values(migrated.value).map(record => {
        if (!Object.hasOwn(v5Schema.types, record.typeName)) throw new Error('Unknown drawing record');
        return v5Schema.types[record.typeName].validate(record);
    });
    const bindings = collectBindings(records);
    const converted: TLStoreSnapshot['store'] = {};
    for (const record of records) {
        switch (record.typeName) {
            case 'shape': {
                const shape = convertedShape(record, source.store[record.id], bindings.get(record.id));
                converted[record.id] = store.schema.types.shape.validate(shape);
                break;
            }
            case 'asset':
                converted[record.id] = store.schema.types.asset.validate(convertedAsset(record));
                break;
            case 'document':
                converted[record.id] = store.schema.types.document.validate(record);
                break;
            case 'page':
                converted[record.id] = store.schema.types.page.validate(record);
                break;
            // Arrow bindings were moved inside their arrows. User and session records stay in the original.
        }
    }
    return { store: converted, schema: store.schema.serialize() };
}
