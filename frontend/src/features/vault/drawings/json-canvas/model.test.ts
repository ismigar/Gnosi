import { describe, expect, it } from 'vitest';
import { JsonCanvasError, parseJsonCanvas } from './model';

import { canvasFixture } from './test-fixture';
describe('JSON Canvas validation', () => {
    it('preserves all supported nodes, edge properties and unknown metadata', () => {
        expect(parseJsonCanvas(JSON.stringify(canvasFixture))).toEqual(canvasFixture);
    });
    it('accepts omitted optional collections', () => {
        expect(parseJsonCanvas('{"custom":true}')).toEqual({ nodes: [], edges: [], custom: true });
    });
    it.each([
        { nodes: [{ ...canvasFixture.nodes[1], type: 'future-node' }] },
        { nodes: [canvasFixture.nodes[1], canvasFixture.nodes[1]] },
        { ...canvasFixture, edges: [{ ...canvasFixture.edges[0], toNode: 'absent' }] },
        { nodes: [{ ...canvasFixture.nodes[1], width: 0 }] },
        { nodes: [{ ...canvasFixture.nodes[1], x: 1.2 }] },
        { nodes: [{ ...canvasFixture.nodes[1], color: 'url(unsafe)' }] },
        { nodes: [{ ...canvasFixture.nodes[2], subpath: 'invalid' }] },
    ])('rejects malformed or unsupported data atomically', value => {
        expect(() => parseJsonCanvas(JSON.stringify(value))).toThrow(JsonCanvasError);
    });
    it('limits resource use', () => {
        expect(() => parseJsonCanvas(JSON.stringify({ nodes: Array.from({ length: 5001 }, (_, id) => ({ ...canvasFixture.nodes[1], id: String(id) })) }))).toThrow(JsonCanvasError);
    });
});
