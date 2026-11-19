import { createShapeId, MAX_SHAPES_PER_PAGE, type Editor, type TLArrowShape, type TLNoteShape, type TLTextShape, type TLShapeId } from '@bigbluebutton/tldraw';
import type { TldrawVaultNote } from '../tldraw-editor/tldrawEditorTypes';
import type { PageCardShape } from '../canvas-page-card/types';
import type { JsonCanvasNodeShape } from './JsonCanvasNodeShape';
import { JsonCanvasError, parseJsonCanvas, sideAnchor, type CanvasSide, type JsonCanvasDocument, type JsonCanvasEdge, type JsonCanvasNode } from './model';

const NODE_TYPE = 'json-canvas-node';
const COLORS = { '1': 'red', '2': 'orange', '3': 'yellow', '4': 'green', '5': 'blue', '6': 'violet' } as const;
const edgeColor = (color?: string) => color && Object.hasOwn(COLORS, color) ? COLORS[color as keyof typeof COLORS] : 'black';

export function importJsonCanvas(editor: Editor, serialized: string, notes: readonly TldrawVaultNote[]): void {
    const document = parseJsonCanvas(serialized);
    if (editor.getCurrentPageShapeIds().size > 0) throw new JsonCanvasError('not_empty');
    const shapeCount = document.nodes.length + document.edges.length;
    if (shapeCount > MAX_SHAPES_PER_PAGE) throw new JsonCanvasError('page_limit');
    const ids = new Map(document.nodes.map(node => [node.id, createShapeId()]));
    const mark = 'import-json-canvas';
    editor.mark(mark);
    try {
        editor.batch(() => {
            for (const node of document.nodes) {
                const id = ids.get(node.id);
                if (!id) throw new JsonCanvasError('invalid');
                const page = notes.find(note => node.gnosiPageId === note.id || node.type === 'file' && !node.subpath && node.file === note.path);
                if (page) {
                    editor.createShape<PageCardShape>({ id, type: 'page-card', x: node.x, y: node.y,
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
                editor.createShape<TLArrowShape>({
                    id: createShapeId(), type: 'arrow',
                    props: {
                        start: { type: 'binding', boundShapeId: fromId, normalizedAnchor: sideAnchor(edge.fromSide), isExact: true, isPrecise: true },
                        end: { type: 'binding', boundShapeId: toId, normalizedAnchor: sideAnchor(edge.toSide), isExact: true, isPrecise: true },
                        arrowheadStart: edge.fromEnd ?? 'none', arrowheadEnd: edge.toEnd ?? 'arrow',
                        color: edgeColor(edge.color), text: edge.label ?? '',
                    },
                    meta: { jsonCanvasEdge: JSON.stringify(edge) },
                });
            }
            if (editor.getCurrentPageShapeIds().size !== shapeCount) throw new JsonCanvasError('unsupported');
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
        if (editor.isShapeOfType<JsonCanvasNodeShape>(shape, NODE_TYPE)) {
            node = JSON.parse(shape.props.data) as JsonCanvasNode;
        } else if (editor.isShapeOfType<PageCardShape>(shape, 'page-card')) {
            if (typeof shape.meta.jsonCanvasNode === 'string') {
                node = JSON.parse(shape.meta.jsonCanvasNode) as JsonCanvasNode;
            } else {
                const note = notes.find(note => note.id === shape.props.pageId);
                node = { id: shape.id, type: typeof note?.path === 'string' ? 'file' : 'text',
                    ...(typeof note?.path === 'string' ? { file: note.path } : { text: `[[${shape.props.pageId}|${shape.props.pageTitle}]]` }),
                    gnosiPageId: shape.props.pageId, x: 0, y: 0, width: 0, height: 0 };
            }
        } else if (editor.isShapeOfType<TLTextShape>(shape, 'text') || editor.isShapeOfType<TLNoteShape>(shape, 'note')) {
            const bounds = editor.getShapePageBounds(shape);
            if (!bounds) throw new JsonCanvasError('unsupported');
            node = { id: shape.id, type: 'text', text: shape.props.text,
                x: shape.x, y: shape.y, width: bounds.w, height: bounds.h,
                gnosiShape: shape };
        } else {
            throw new JsonCanvasError('unsupported');
        }
        const bounds = editor.getShapePageBounds(shape);
        const width = bounds?.w ?? node.width;
        const height = bounds?.h ?? node.height;
        ids.set(shape.id, node.id);
        nodes.push({ ...node, x: Math.round(shape.x), y: Math.round(shape.y), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) });
    }
    for (const shape of shapes) {
        if (!editor.isShapeOfType<TLArrowShape>(shape, 'arrow')) continue;
        if (shape.props.bend !== 0 || !['none', 'arrow'].includes(shape.props.arrowheadStart) || !['none', 'arrow'].includes(shape.props.arrowheadEnd)) throw new JsonCanvasError('unsupported');
        const { start, end } = shape.props;
        if (start.type !== 'binding' || end.type !== 'binding') throw new JsonCanvasError('unsupported');
        const fromNode = ids.get(start.boundShapeId);
        const toNode = ids.get(end.boundShapeId);
        if (!fromNode || !toNode) throw new JsonCanvasError('unsupported');
        const raw = typeof shape.meta.jsonCanvasEdge === 'string' ? JSON.parse(shape.meta.jsonCanvasEdge) as JsonCanvasEdge : null;
        const edge: JsonCanvasEdge = { ...raw, id: raw?.id ?? shape.id, fromNode, toNode };
        const fromSide = anchorSide(start.normalizedAnchor);
        const toSide = anchorSide(end.normalizedAnchor);
        if (fromSide) edge.fromSide = fromSide; else delete edge.fromSide;
        if (toSide) edge.toSide = toSide; else delete edge.toSide;
        if (raw?.fromEnd !== undefined || shape.props.arrowheadStart !== 'none') edge.fromEnd = shape.props.arrowheadStart as 'none' | 'arrow';
        if (raw?.toEnd !== undefined || shape.props.arrowheadEnd !== 'arrow') edge.toEnd = shape.props.arrowheadEnd as 'none' | 'arrow';
        const label = shape.props.text;
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
