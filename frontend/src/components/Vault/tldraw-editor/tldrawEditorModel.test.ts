import { describe, expect, it } from 'vitest';

import {
    assessDrawingSnapshot,
    parseDroppedCanvasNote,
} from './tldrawEditorModel';

describe('tldrawEditorModel', () => {
    it('accepts empty initial drawing documents without loading a snapshot', () => {
        expect(assessDrawingSnapshot({})).toEqual({ kind: 'empty' });
        expect(assessDrawingSnapshot(null)).toEqual({ kind: 'empty' });
    });

    it('preserves a direct tldraw store snapshot', () => {
        const snapshot = {
            schema: { schemaVersion: 2 },
            store: { 'shape:one': { typeName: 'shape' } },
        };

        expect(assessDrawingSnapshot(snapshot)).toEqual({
            kind: 'loadable',
            snapshot,
        });
    });

    it('normalizes the historical document wrapper used by saved drawings', () => {
        expect(assessDrawingSnapshot({
            document: {
                schema: { schemaVersion: 1 },
                store: { 'shape:legacy': { typeName: 'shape' } },
            },
            session: { currentPageId: 'page:one' },
        })).toEqual({
            kind: 'loadable',
            snapshot: {
                schema: { schemaVersion: 1 },
                store: { 'shape:legacy': { typeName: 'shape' } },
            },
        });
    });

    it('blocks non-empty legacy drawing formats', () => {
        expect(assessDrawingSnapshot({ elements: [{ id: 'legacy' }] }))
            .toEqual({ kind: 'incompatible' });
    });

    it('validates dropped Vault page payloads before using them', () => {
        expect(parseDroppedCanvasNote(JSON.stringify({
            id: 'page-1',
            title: 'Evidence',
        }))).toEqual({ id: 'page-1', title: 'Evidence' });
        expect(() => parseDroppedCanvasNote('{"title":"Missing id"}'))
            .toThrow('Dropped Vault note has no id');
    });
});
