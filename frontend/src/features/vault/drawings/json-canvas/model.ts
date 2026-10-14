export interface JsonCanvasNode extends Record<string, unknown> {
    id: string;
    type: 'text' | 'file' | 'link' | 'group';
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    text?: string;
    file?: string;
    subpath?: string;
    url?: string;
    label?: string;
    background?: string;
    backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export interface JsonCanvasEdge extends Record<string, unknown> {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: CanvasSide;
    toSide?: CanvasSide;
    fromEnd?: 'none' | 'arrow';
    toEnd?: 'none' | 'arrow';
    color?: string;
    label?: string;
}
export interface JsonCanvasDocument extends Record<string, unknown> {
    nodes: JsonCanvasNode[];
    edges: JsonCanvasEdge[];
}
export class JsonCanvasError extends Error {
    constructor(readonly reason: 'invalid' | 'unsupported' | 'not_empty' | 'too_large') { super(reason); }
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const stringField = (value: unknown) => value === undefined || typeof value === 'string';
const colorField = (value: unknown) => value === undefined || typeof value === 'string' && /^(#[\da-fA-F]{6}|[1-6])$/.test(value);
const enumField = (value: unknown, allowed: readonly string[]) => value === undefined || typeof value === 'string' && allowed.includes(value);
const SIDES = ['top', 'right', 'bottom', 'left'];
export const MAX_CANVAS_BYTES = 10 * 1024 * 1024;

/** JSON Canvas 1.0. Unknown fields remain intact, unknown shape types are rejected. */
export function parseJsonCanvas(serialized: string): JsonCanvasDocument {
    if (serialized.length > MAX_CANVAS_BYTES) throw new JsonCanvasError('too_large');
    let raw: unknown;
    try { raw = JSON.parse(serialized); } catch { throw new JsonCanvasError('invalid'); }
    if (!isRecord(raw) || raw.nodes !== undefined && !Array.isArray(raw.nodes) || raw.edges !== undefined && !Array.isArray(raw.edges)) throw new JsonCanvasError('invalid');
    const nodes: unknown[] = Array.isArray(raw.nodes) ? raw.nodes : [];
    const edges: unknown[] = Array.isArray(raw.edges) ? raw.edges : [];
    if (nodes.length + edges.length > 5000) throw new JsonCanvasError('too_large');
    const ids = new Set<string>();
    for (const node of nodes) {
        if (!isRecord(node) || typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw new JsonCanvasError('invalid');
        if (!['text', 'file', 'link', 'group'].includes(String(node.type))) throw new JsonCanvasError('unsupported');
        if (![node.x, node.y, node.width, node.height].every(value => typeof value === 'number' && Number.isSafeInteger(value))
            || Number(node.width) <= 0 || Number(node.height) <= 0 || !colorField(node.color)) throw new JsonCanvasError('invalid');
        if (node.type === 'text' && typeof node.text !== 'string'
            || node.type === 'file' && (typeof node.file !== 'string' || !stringField(node.subpath) || typeof node.subpath === 'string' && !node.subpath.startsWith('#'))
            || node.type === 'link' && typeof node.url !== 'string'
            || node.type === 'group' && (!stringField(node.label) || !stringField(node.background) || !enumField(node.backgroundStyle, ['cover', 'ratio', 'repeat']))) throw new JsonCanvasError('invalid');
        ids.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of edges) {
        if (!isRecord(edge) || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id)
            || typeof edge.fromNode !== 'string' || !ids.has(edge.fromNode) || typeof edge.toNode !== 'string' || !ids.has(edge.toNode)
            || !enumField(edge.fromSide, SIDES) || !enumField(edge.toSide, SIDES)
            || !enumField(edge.fromEnd, ['none', 'arrow']) || !enumField(edge.toEnd, ['none', 'arrow'])
            || !stringField(edge.label) || !colorField(edge.color)) throw new JsonCanvasError('invalid');
        edgeIds.add(edge.id);
    }
    return { ...raw, nodes: nodes as JsonCanvasNode[], edges: edges as JsonCanvasEdge[] };
}

export function canvasColor(color: string | undefined): string {
    const colors: Record<string, string> = { '1': '#e05252', '2': '#df8b39', '3': '#bea72b', '4': '#4b9d68', '5': '#409faf', '6': '#9971c8' };
    return color && /^(#[\da-fA-F]{6}|[1-6])$/.test(color) ? colors[color] ?? color : 'var(--border-primary)';
}
export function sideAnchor(side?: CanvasSide): { x: number; y: number } {
    switch (side) {
        case 'top': return { x: 0.5, y: 0 };
        case 'bottom': return { x: 0.5, y: 1 };
        case 'left': return { x: 0, y: 0.5 };
        case 'right': return { x: 1, y: 0.5 };
        default: return { x: 0.5, y: 0.5 };
    }
}
