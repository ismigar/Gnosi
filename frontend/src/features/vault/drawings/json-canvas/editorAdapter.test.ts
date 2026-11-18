import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTLStore, defaultShapeUtils, defaultTools, Editor, MAX_SHAPES_PER_PAGE } from '@bigbluebutton/tldraw';
import { loadDrawingDocument, serializeDrawingDocument } from '../drawingSnapshot';
import { PageCardShapeUtil } from '../canvasPageCardShape';
import { JsonCanvasNodeShapeUtil, type JsonCanvasNodeShape } from './JsonCanvasNodeShape';
import { exportJsonCanvas, importJsonCanvas } from './editorAdapter';
import { canvasFixture } from './test-fixture';

const shapeUtils: typeof defaultShapeUtils = [...defaultShapeUtils, PageCardShapeUtil, JsonCanvasNodeShapeUtil];
let editor: Editor;
let container: HTMLDivElement;
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = new Editor({ store: createTLStore({ shapeUtils }), shapeUtils, tools: defaultTools, getContainer: () => container });
});
afterEach(() => { editor.dispose(); container.remove(); vi.unstubAllGlobals(); });

describe('JSON Canvas editor roundtrip', () => {
    it('survives import, tldraw persistence, and export with original node order and extension metadata', () => {
        importJsonCanvas(editor, JSON.stringify(canvasFixture), []);
        const snapshot = serializeDrawingDocument(editor.store, null);
        loadDrawingDocument(editor.store, snapshot);
        expect(exportJsonCanvas(editor, [])).toEqual(canvasFixture);
    });
    it('exports edits to position, dimensions, text and bound endpoints', () => {
        importJsonCanvas(editor, JSON.stringify(canvasFixture), []);
        const shape = editor.getCurrentPageShapes().find(shape => editor.isShapeOfType<JsonCanvasNodeShape>(shape, 'json-canvas-node') && (JSON.parse(shape.props.data) as { id: string }).id === 'text') as JsonCanvasNodeShape;
        editor.updateShape({ id: shape.id, type: shape.type, x: 150, y: 160, props: { w: 310, data: JSON.stringify({ ...JSON.parse(shape.props.data), text: 'Edited' }) } });
        const document = exportJsonCanvas(editor, []);
        expect(document.nodes.find(node => node.id === 'text')).toMatchObject({ x: 150, y: 160, width: 310, text: 'Edited', unknown: ['retain'] });
        expect(document.edges).toEqual(canvasFixture.edges);
    });
    it('does not replace an existing drawing or export unsupported shapes silently', () => {
        editor.createShape({ type: 'geo' });
        const count = editor.getCurrentPageShapeIds().size;
        expect(() => { importJsonCanvas(editor, JSON.stringify(canvasFixture), []); }).toThrow('not_empty');
        expect(editor.getCurrentPageShapeIds().size).toBe(count);
        expect(() => exportJsonCanvas(editor, [])).toThrow('unsupported');
    });
    it('rejects imports exceeding the page limit before adding nodes or their edges', () => {
        const node = { type: 'text', text: '', x: 0, y: 0, width: 100, height: 50 };
        const nodes = Array.from({ length: MAX_SHAPES_PER_PAGE }, (_, index) => ({ ...node, id: String(index) }));
        const edges = [{ id: 'edge', fromNode: '0', toNode: '1' }];
        const create = vi.spyOn(editor, 'createShape');
        expect(() => { importJsonCanvas(editor, JSON.stringify({ nodes, edges }), []); }).toThrow('page_limit');
        expect(create).not.toHaveBeenCalled();
        expect(editor.getCurrentPageShapeIds().size).toBe(0);
    });
    it('rolls back a failed editor conversion instead of leaving a partial import', () => {
        vi.spyOn(editor, 'updatePage').mockImplementationOnce(() => { throw new Error('Synthetic failure'); });
        expect(() => { importJsonCanvas(editor, JSON.stringify(canvasFixture), []); }).toThrow('Synthetic failure');
        expect(editor.getCurrentPageShapeIds().size).toBe(0);
    });

});
