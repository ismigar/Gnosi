import { createBindingId, createShapeId, renderPlaintextFromRichText, toRichText, type Editor, type TLArrowShape, type TLShapeId } from 'tldraw';
import type { TldrawVaultNote } from '../tldraw-editor/tldrawEditorTypes';
import type { JsonCanvasNodeShape } from './JsonCanvasNodeShape';
import { JsonCanvasError, parseJsonCanvas, sideAnchor, type CanvasSide, type JsonCanvasDocument, type JsonCanvasEdge, type JsonCanvasNode } from './model';

const NODE_TYPE = 'json-canvas-node';
const COLORS = { '1': 'red', '2': 'orange', '3': 'yellow', '4': 'green', '5': 'blue', '6': 'violet' } as const;
const edgeColor = (color?: string) => color && Object.hasOwn(COLORS, color) ? COLORS[color as keyof typeof COLORS] : 'black';

export function importJsonCanvas(editor: Editor, serialized: string, notes: readonly TldrawVaultNote[]): void {
    const document = parseJsonCanvas(serialized);
    if (editor.getCurrentPageShapeIds().size > 0) throw new JsonCanvasError('not_empty');
    const ids = new Map(document.nodes.map(node => [node.id, createShapeId()]));
    const mark = editor.markHistoryStoppingPoint('Import JSON Canvas');
    try {
        editor.run(() => {
        for (const node of document.nodes) {
            const id = ids.get(node.id);
            if (!id) throw new JsonCanvasError('invalid');
            const page = notes.find(note => node.gnosiPageId === note.id || node.type === 'file' && !node.subpath && node.file === note.path);
            if (page) {
                editor.createShape({ id, type: 'page-card', x: node.x, y: node.y,
                    props: { w: node.width, h: node.height, pageId: page.id, pageTitle: page.title ?? '' },
                    meta: { jsonCanvasNode: JSON.stringify(node) } });
            } else {
                editor.createShape<JsonCanvasNodeShape>({ id, type: NODE_TYPE, x: node.x, y: node.y,
                    props: { w: node.width, h: node.height, data: JSON.stringify(node) } });
            }
        }
        for (const edge of document.edges) {
            const fromId = ids.get(edge.fromNode);
            const toId = ids.get(edge.toNode);
            if (!fromId || !toId) throw new JsonCanvasError('invalid');
            const from = editor.getShape(fromId);
            const to = editor.getShape(toId);
            if (!from || !to) throw new JsonCanvasError('invalid');
            const id = createShapeId();
            editor.createShape<TLArrowShape>({ id, type: 'arrow', x: from.x, y: from.y,
                props: { start: { x: 0, y: 0 }, end: { x: to.x - from.x, y: to.y - from.y },
                    arrowheadStart: edge.fromEnd ?? 'none', arrowheadEnd: edge.toEnd ?? 'arrow',
                    color: edgeColor(edge.color), richText: toRichText(edge.label ?? '') },
                meta: { jsonCanvasEdge: JSON.stringify(edge) } });
            editor.createBindings([
                { id: createBindingId(), type: 'arrow', fromId: id, toId: fromId,
                    props: { terminal: 'start', normalizedAnchor: sideAnchor(edge.fromSide), isExact: true, isPrecise: true } },
                { id: createBindingId(), type: 'arrow', fromId: id, toId,
                    props: { terminal: 'end', normalizedAnchor: sideAnchor(edge.toSide), isExact: true, isPrecise: true } },
            ]);
        }
        const page = editor.getCurrentPage();
        const { nodes: _nodes, edges: _edges, ...metadata } = document;
        editor.updatePage({ id: page.id, meta: { ...page.meta, jsonCanvasRoot: JSON.stringify(metadata) } });
        });
    } catch (error) {
        editor.bailToMark(mark);
        throw error;
    }
    editor.zoomToFit();
}
function anchorSide(anchor: { x: number; y: number }): CanvasSide | undefined {
    if (anchor.x === 0.5 && anchor.y === 0.5) return undefined;
    if (anchor.x === 0.5 && anchor.y === 0) return 'top';
    if (anchor.x === 0.5 && anchor.y === 1) return 'bottom';
    if (anchor.x === 0 && anchor.y === 0.5) return 'left';
    if (anchor.x === 1 && anchor.y === 0.5) return 'right';
    throw new JsonCanvasError('unsupported');
}

/** Refuse unsupported drawing shapes instead of silently omitting them. */
export function exportJsonCanvas(editor: Editor, notes: readonly TldrawVaultNote[]): JsonCanvasDocument {
    const page = editor.getCurrentPage();
    const nodes: JsonCanvasNode[] = [];
    const edges: JsonCanvasEdge[] = [];
    const ids = new Map<TLShapeId, string>();
    const shapes = editor.getCurrentPageShapesSorted();
    for (const shape of shapes) {
        if (shape.parentId !== page.id || shape.rotation !== 0 || shape.opacity !== 1) throw new JsonCanvasError('unsupported');
        if (shape.type === 'arrow') continue;
        let node: JsonCanvasNode;
        if (shape.type === NODE_TYPE) {
            node = JSON.parse(shape.props.data) as JsonCanvasNode;
        } else if (shape.type === 'page-card') {
            if (typeof shape.meta.jsonCanvasNode === 'string') {
                node = JSON.parse(shape.meta.jsonCanvasNode) as JsonCanvasNode;
            } else {
                const note = notes.find(note => note.id === shape.props.pageId);
                node = { id: shape.id, type: typeof note?.path === 'string' ? 'file' : 'text',
                    ...(typeof note?.path === 'string' ? { file: note.path } : { text: `[[${shape.props.pageId}|${shape.props.pageTitle}]]` }),
                    gnosiPageId: shape.props.pageId, x: 0, y: 0, width: 0, height: 0 };
            }
        } else if (shape.type === 'text' || shape.type === 'note') {
            const bounds = editor.getShapePageBounds(shape);
            if (!bounds) throw new JsonCanvasError('unsupported');
            node = { id: shape.id, type: 'text', text: renderPlaintextFromRichText(editor, shape.props.richText),
                x: shape.x, y: shape.y, width: bounds.w, height: bounds.h,
                gnosiShape: shape };
        } else {
            throw new JsonCanvasError('unsupported');
        }
        const bounds = editor.getShapePageBounds(shape);
        const width = shape.type === NODE_TYPE || shape.type === 'page-card' ? shape.props.w : bounds?.w ?? node.width;
        const height = shape.type === NODE_TYPE || shape.type === 'page-card' ? shape.props.h : bounds?.h ?? node.height;
        ids.set(shape.id, node.id);
        nodes.push({ ...node, x: Math.round(shape.x), y: Math.round(shape.y), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) });
    }
    for (const shape of shapes) {
        if (shape.type !== 'arrow') continue;
        if (shape.props.bend !== 0 || shape.props.kind !== 'arc' || !['none', 'arrow'].includes(shape.props.arrowheadStart) || !['none', 'arrow'].includes(shape.props.arrowheadEnd)) throw new JsonCanvasError('unsupported');
        const bindings = editor.getBindingsFromShape(shape, 'arrow');
        const from = bindings.find(binding => binding.props.terminal === 'start');
        const to = bindings.find(binding => binding.props.terminal === 'end');
        const fromNode = from && ids.get(from.toId);
        const toNode = to && ids.get(to.toId);
        if (!from || !to || !fromNode || !toNode) throw new JsonCanvasError('unsupported');
        const raw = typeof shape.meta.jsonCanvasEdge === 'string' ? JSON.parse(shape.meta.jsonCanvasEdge) as JsonCanvasEdge : null;
        const edge: JsonCanvasEdge = { ...raw, id: raw?.id ?? shape.id, fromNode, toNode };
        const fromSide = anchorSide(from.props.normalizedAnchor);
        const toSide = anchorSide(to.props.normalizedAnchor);
        if (fromSide) edge.fromSide = fromSide; else delete edge.fromSide;
        if (toSide) edge.toSide = toSide; else delete edge.toSide;
        if (raw?.fromEnd !== undefined || shape.props.arrowheadStart !== 'none') edge.fromEnd = shape.props.arrowheadStart as 'none' | 'arrow';
        if (raw?.toEnd !== undefined || shape.props.arrowheadEnd !== 'arrow') edge.toEnd = shape.props.arrowheadEnd as 'none' | 'arrow';
        const label = renderPlaintextFromRichText(editor, shape.props.richText);
        if (raw?.label !== undefined || label) edge.label = label;
        if (shape.props.color !== edgeColor(raw?.color)) {
            const color = Object.entries(COLORS).find(([, value]) => value === shape.props.color)?.[0];
            if (!color) throw new JsonCanvasError('unsupported');
            edge.color = color;
        }
        edges.push(edge);
    }
    const metadata: unknown = typeof page.meta.jsonCanvasRoot === 'string' ? JSON.parse(page.meta.jsonCanvasRoot) : {};
    return parseJsonCanvas(JSON.stringify({ ...(typeof metadata === 'object' && metadata !== null ? metadata : {}), nodes, edges }));
}
